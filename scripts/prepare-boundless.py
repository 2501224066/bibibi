"""Convert 海阔天空 MIDI to a full-length 5-track band fixture for bibibi.
Usage: python3 scripts/prepare-boundless.py "/Users/zhangjing/Downloads/海阔天空.mid"
"""
import bisect
import json
import struct
import sys
from collections import defaultdict, deque
from pathlib import Path


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/zhangjing/Downloads/海阔天空.mid')
    data = source.read_bytes()
    assert data[:4] == b'MThd', 'Not a Standard MIDI File'
    fmt, count, ppqn = struct.unpack('>HHH', data[8:14])
    assert fmt in (0, 1) and not ppqn & 0x8000, 'Requires metrical format 0/1 MIDI'
    position = 8 + int.from_bytes(data[4:8], 'big')

    tempos = [(0, 731707)]
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
                    for enc in ('gbk', 'utf-8', 'latin1'):
                        try:
                            track_name = payload.decode(enc)
                            break
                        except:
                            pass
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

    earliest_tick = 0
    offset_ms = milliseconds(earliest_tick)

    # 5 Iconic Tracks arranged for Beyond:
    # Track 0: 'piano' -> Full Piano (Right Hand 1 + Left Hand 2) starts at 0.0s
    # Track 1: 'synth' -> Vocal Lead (Vocal 3 + Harmony 4) starts at 16.8s
    # Track 2: 'synth' -> Electric Guitar Solo (Track 6) starts at 175.6s
    # Track 3: 'synth' -> Rock Bass (Track 13) starts at 62.9s
    # Track 4: 'drums' -> Full Drum Kit (Cymbals 7 + Kit 8) starts at 93.7s
    specs = [
        ('piano', [(1, 0.70), (2, 0.65)]),
        ('synth', [(3, 0.85), (4, 0.60)]),
        ('synth', [(6, 0.75)]),
        ('synth', [(13, 0.70)]),
        ('drums', [(7, 0.70), (8, 0.70)]),
    ]

    GM_DRUM_MAP = {
        35: 8, 36: 8,         # Bass Drum -> 底鼓
        38: 0, 40: 0, 37: 0,   # Snare, Side Stick -> 军鼓
        41: 7, 43: 7,         # Floor Tom -> 落地通鼓
        45: 6, 47: 6,         # Mid Tom -> 中通鼓
        48: 1, 50: 1,         # High Tom -> 高通鼓
        42: 2, 44: 2,         # Closed/Pedal Hi-Hat -> 闭合踩镲
        46: 3,                # Open Hi-Hat -> 开放踩镲
        49: 4, 57: 4,         # Crash Cymbal -> 吊镲
        51: 5, 59: 5,         # Ride Cymbal -> 叮叮镲
        52: 10,               # Chinese Cymbal -> 吊镲Ⅱ
        55: 11,               # Splash Cymbal -> 水镲
    }
    DRUM_DURATIONS = {
        0: 320.0, 1: 550.0, 2: 120.0, 3: 650.0, 4: 1800.0, 5: 1400.0,
        6: 650.0, 7: 800.0, 8: 450.0, 9: 220.0, 10: 2100.0, 11: 800.0,
    }

    output_tracks = []
    all_end_times = []

    for inst, sources in specs:
        notes = []
        for src_idx, base_vel in sources:
            name, events = tracks_events[src_idx]
            active = defaultdict(deque)

            for tick, kind, channel, values in events:
                if tick < earliest_tick:
                    continue
                pitch = values[0]
                velocity = values[1] if len(values) > 1 else 0

                if kind == 9 and velocity > 0:
                    if inst == 'drums':
                        drum_idx = GM_DRUM_MAP.get(pitch, pitch % 12)
                        dur = DRUM_DURATIONS.get(drum_idx, 300.0)
                        start_ms = round(milliseconds(tick) - offset_ms, 3)
                        scale = 0.40 if drum_idx in (2, 3) else 1.0
                        v = round((velocity / 127.0) * base_vel * scale, 6)
                        notes.append(dict(
                            index=drum_idx,
                            start=start_ms,
                            duration=dur,
                            octave=1,
                            velocity=v,
                            vibrato=False,
                        ))
                        all_end_times.append(start_ms + dur)
                    else:
                        active[pitch].append((tick, velocity))
                elif kind == 8 or (kind == 9 and velocity == 0):
                    if inst != 'drums':
                        queue = active[pitch]
                        if not queue:
                            continue
                        start_tick, start_vel = queue.popleft()
                        start_ms = round(milliseconds(start_tick) - offset_ms, 3)
                        end_ms = round(milliseconds(tick) - offset_ms, 3)
                        dur_ms = round(max(10.0, end_ms - start_ms), 3)
                        v = round((start_vel / 127.0) * base_vel, 6)
                        notes.append(dict(
                            index=pitch % 12,
                            midiNote=pitch,
                            start=start_ms,
                            duration=dur_ms,
                            octave=max(0, min(2, (pitch - 48) // 12)),
                            velocity=v,
                            vibrato=False,
                        ))
                        all_end_times.append(start_ms + dur_ms)

            assert not any(active.values()), f'Unterminated notes in source {src_idx} ({name})'

        notes.sort(key=lambda n: n['start'])
        output_tracks.append(dict(
            instrument=inst,
            duration=0,
            checked=True,
            loop=False,
            notes=notes,
        ))

    song_duration = round(max(all_end_times), 3)
    for t in output_tracks:
        t['duration'] = song_duration

    fixture = dict(
        id='demo-boundless-midi-v1',
        name='海阔天空-Beyond',
        duration=song_duration,
        tracks=output_tracks,
    )

    out_file = Path(__file__).resolve().parents[1] / 'miniprogram/assets/demo-boundless.json'
    out_file.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')), encoding='utf8')

    print(f'Successfully wrote {out_file}')
    print(f'Song: {fixture["name"]} ({fixture["id"]}), duration: {song_duration}ms ({song_duration/1000:.2f}s)')
    for i, t in enumerate(fixture['tracks']):
        notes = t.get('notes', [])
        inst = t.get('instrument')
        first = f', starts at {notes[0]["start"]}ms' if notes else ''
        print(f'  Track {i}: {inst} ({len(notes)} notes{first})')


if __name__ == '__main__':
    main()
