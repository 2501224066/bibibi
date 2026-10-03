"""Convert Nocturne MIDI to a full-length app fixture for bibibi.
Usage: python3 scripts/prepare-nocturne.py /Users/zhangjing/Downloads/夜曲-周杰伦.mid
"""
import bisect
import json
import struct
import sys
from collections import defaultdict, deque
from pathlib import Path


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/zhangjing/Downloads/夜曲-周杰伦.mid')
    data = source.read_bytes()
    assert data[:4] == b'MThd', 'Not a Standard MIDI File'
    fmt, count, ppqn = struct.unpack('>HHH', data[8:14])
    assert fmt in (0, 1) and not ppqn & 0x8000, 'Requires metrical format 0/1 MIDI'
    position = 8 + int.from_bytes(data[4:8], 'big')

    tempos = [(0, 674157)]
    tracks_events = []

    for track in range(count):
        assert data[position:position + 4] == b'MTrk'
        size = int.from_bytes(data[position + 4:position + 8], 'big')
        body = data[position + 8:position + 8 + size]
        position += 8 + size
        cursor = tick = status = 0
        track_name = ''
        events = []

        def vlq():
            nonlocal cursor
            result = 0
            for _ in range(4):
                byte = body[cursor]
                cursor += 1
                result = (result << 7) | (byte & 127)
                if byte < 128:
                    return result
            raise ValueError('Invalid variable-length integer')

        while cursor < len(body):
            tick += vlq()
            byte = body[cursor]
            if byte & 128:
                cursor += 1
                status = byte
            else:
                assert status, 'Invalid running status'
                byte = status
            if byte == 255:
                kind = body[cursor]
                cursor += 1
                length = vlq()
                payload = body[cursor:cursor + length]
                cursor += length
                if kind == 81:
                    tempos.append((tick, int.from_bytes(payload, 'big')))
                elif kind == 3:
                    track_name = payload.decode('latin1', 'replace')
            elif byte in (240, 247):
                length = vlq()
                cursor += length
                status = 0
            else:
                kind, channel = byte >> 4, byte & 15
                length = 1 if kind in (12, 13) else 2
                values = tuple(body[cursor:cursor + length])
                cursor += length
                events.append((tick, kind, channel, values))
        tracks_events.append((track_name, events))

    tempo_map = dict(tempos)
    tempo_ticks = sorted(tempo_map)
    tempo_ms = [0.0]
    for previous, current in zip(tempo_ticks, tempo_ticks[1:]):
        tempo_ms.append(tempo_ms[-1] + (current - previous) * tempo_map[previous] / ppqn / 1000)

    def milliseconds(tick):
        index = bisect.bisect_right(tempo_ticks, tick) - 1
        return tempo_ms[index] + (tick - tempo_ticks[index]) * tempo_map[tempo_ticks[index]] / ppqn / 1000

    # Earliest musical note across all tracks (guitar solo starts at tick 336)
    earliest_tick = 336
    offset_ms = milliseconds(earliest_tick)

    DRUM_DURATIONS = {
        0: 320.0, 1: 550.0, 2: 120.0, 3: 650.0, 4: 1800.0, 5: 1400.0,
        6: 650.0, 7: 800.0, 8: 450.0, 9: 220.0, 10: 2100.0, 11: 800.0,
    }
    GM_DRUM_MAP = {
        35: 8, 36: 8,       # Acoustic Bass Drum, Bass Drum 1 -> 底鼓
        38: 0, 40: 0,       # Acoustic Snare, Electric Snare -> 军鼓
        37: 0,              # Side Stick -> 军鼓
        41: 7, 43: 7,       # Low Floor Tom, High Floor Tom -> 落地通鼓
        45: 6, 47: 6,       # Low Tom, Low-Mid Tom -> 中通鼓
        48: 1, 50: 1,       # Hi-Mid Tom, High Tom -> 高通鼓
        42: 2, 44: 2,       # Closed Hi-Hat, Pedal Hi-Hat -> 闭合踩镲
        46: 3,              # Open Hi-Hat -> 开放踩镲
        49: 4, 57: 4,       # Crash Cymbal 1, Crash Cymbal 2 -> 吊镲
        51: 5, 59: 5,       # Ride Cymbal 1, Ride Cymbal 2 -> 叮叮镲
        52: 10,             # Chinese Cymbal -> 吊镲Ⅱ
        55: 11,             # Splash Cymbal -> 水镲
    }

    # 5 Iconic Tracks arranged logically:
    # Track 0: 'guitar'   -> Solo / Lead Guitar (piano) starts at 0.00s!
    # Track 1: 'subvocal' -> Main Vocal Melody (synth) starts at chorus (38.26s)
    # Track 2: 'guitar 2' -> Rhythm Guitar Arpeggios (piano) starts at 0.33s
    # Track 3: 'bass'     -> Bassline (synth) starts at 10.45s
    # Track 4: 'drums'   -> Full Drum Beat (drums) starts at 0.33s
    track_specs = [
        (4, 'piano', 0.85),
        (3, 'synth', 0.85),
        (8, 'piano', None),  # scaled from velocity
        (5, 'synth', 0.70),
        (10, 'drums', 0.70),
    ]

    output_tracks = []
    all_end_times = []

    for track_index, instrument, base_velocity in track_specs:
        name, events = tracks_events[track_index]
        active = defaultdict(deque)
        notes = []

        for tick, kind, channel, values in events:
            if tick < earliest_tick:
                continue
            pitch = values[0]
            velocity = values[1] if len(values) > 1 else 0

            if kind == 9 and velocity > 0:
                if instrument == 'drums':
                    drum_idx = GM_DRUM_MAP.get(pitch, pitch % 12)
                    drum_dur = DRUM_DURATIONS.get(drum_idx, 300.0)
                    start_ms = round(milliseconds(tick) - offset_ms, 3)
                    drum_scale = 0.40 if drum_idx in (2, 3) else 1.0
                    v = round((velocity / 127.0) * base_velocity * drum_scale, 6)
                    notes.append(dict(
                        index=drum_idx,
                        start=start_ms,
                        duration=drum_dur,
                        octave=1,
                        velocity=v,
                        vibrato=False,
                    ))
                    all_end_times.append(start_ms + drum_dur)
                else:
                    active[pitch].append((tick, velocity))
            elif kind == 8 or (kind == 9 and velocity == 0):
                if instrument != 'drums':
                    queue = active[pitch]
                    if not queue:
                        continue
                    start_tick, start_vel = queue.popleft()
                    start_ms = round(milliseconds(start_tick) - offset_ms, 3)
                    end_ms = round(milliseconds(tick) - offset_ms, 3)
                    duration_ms = round(max(10.0, end_ms - start_ms), 3)
                    if base_velocity is not None:
                        v = round(base_velocity, 6)
                    else:
                        v = round((start_vel / 127.0) * 0.65, 6)
                    notes.append(dict(
                        index=pitch % 12,
                        midiNote=pitch,
                        start=start_ms,
                        duration=duration_ms,
                        octave=max(0, min(2, (pitch - 48) // 12)),
                        velocity=v,
                        vibrato=False,
                    ))
                    all_end_times.append(start_ms + duration_ms)

        assert not any(active.values()), f'Unterminated notes in track {track_index} ({name})'
        notes.sort(key=lambda n: n['start'])
        output_tracks.append(dict(
            instrument=instrument,
            duration=0,
            checked=True,
            loop=False,
            notes=notes,
        ))

    song_duration = round(max(all_end_times), 3)
    for t in output_tracks:
        t['duration'] = song_duration

    fixture = dict(
        id='demo-nocturne-midi-v1',
        name='夜曲-周杰伦',
        duration=song_duration,
        tracks=output_tracks,
    )

    out_file = Path(__file__).resolve().parents[1] / 'miniprogram/assets/demo-nocturne.json'
    out_file.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')), encoding='utf8')

    print(f'Successfully wrote {out_file}')
    print(f'Song: {fixture["name"]} ({fixture["id"]}), duration: {song_duration}ms ({song_duration/1000:.2f}s)')
    for i, t in enumerate(fixture['tracks']):
        print(f'  Track {i}: {t["instrument"]} ({len(t["notes"])} notes, starts at {t["notes"][0]["start"]}ms)')


if __name__ == '__main__':
    main()
