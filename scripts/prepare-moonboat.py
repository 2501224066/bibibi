"""Convert FF14-月亮船（快乐星球）-王英姿 MIDI to a full-length piano fixture for bibibi.
Usage: python3 scripts/prepare-moonboat.py "/Users/zhangjing/Downloads/FF14-月亮船（快乐星球）-王英姿.mid"
"""
import bisect
import json
import struct
import sys
from collections import defaultdict, deque
from pathlib import Path


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/zhangjing/Downloads/FF14-月亮船（快乐星球）-王英姿.mid')
    data = source.read_bytes()
    assert data[:4] == b'MThd', 'Not a Standard MIDI File'
    fmt, count, ppqn = struct.unpack('>HHH', data[8:14])
    assert fmt in (0, 1) and not ppqn & 0x8000, 'Requires metrical format 0/1 MIDI'
    position = 8 + int.from_bytes(data[4:8], 'big')

    tempos = [(0, 500000)]
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

    # Notes are in track index 2 (505 notes)
    # Split into:
    # Right hand melody: pitch >= 67
    # Left hand accompaniment: pitch <= 64
    all_events = tracks_events[2][1]
    active = defaultdict(deque)
    all_raw_notes = []

    for tick, kind, channel, values in all_events:
        pitch = values[0]
        velocity = values[1] if len(values) > 1 else 0

        if kind == 9 and velocity > 0:
            active[pitch].append((tick, velocity))
        elif kind == 8 or (kind == 9 and velocity == 0):
            queue = active[pitch]
            if not queue:
                continue
            start_tick, start_vel = queue.popleft()
            start_ms = round(milliseconds(start_tick), 3)
            end_ms = round(milliseconds(tick), 3)
            duration_ms = round(max(10.0, end_ms - start_ms), 3)
            all_raw_notes.append((start_ms, duration_ms, pitch, start_vel))

    assert not any(active.values()), 'Unterminated notes found'

    output_tracks = []
    all_end_times = []

    # Track 0: Right hand melody (pitch >= 67, base_vel=0.85)
    # Track 1: Left hand accompaniment (pitch <= 64, base_vel=0.70)
    for is_melody, base_vel in [(True, 0.85), (False, 0.70)]:
        track_notes = []
        for start_ms, duration_ms, pitch, start_vel in all_raw_notes:
            if (is_melody and pitch >= 67) or (not is_melody and pitch <= 64):
                v = round((start_vel / 127.0) * base_vel, 6)
                track_notes.append(dict(
                    index=pitch % 12,
                    midiNote=pitch,
                    start=start_ms,
                    duration=duration_ms,
                    octave=max(0, min(2, (pitch - 48) // 12)),
                    velocity=v,
                    vibrato=False,
                ))
                all_end_times.append(start_ms + duration_ms)

        track_notes.sort(key=lambda n: n['start'])
        output_tracks.append(dict(
            instrument='piano',
            duration=0,
            checked=True,
            loop=False,
            notes=track_notes,
        ))

    song_duration = round(max(all_end_times), 3)
    for t in output_tracks:
        t['duration'] = song_duration

    # Add 3 empty tracks to make a 5-track layout
    for _ in range(3):
        output_tracks.append(dict(
            instrument=None,
            duration=0,
            checked=True,
            loop=False,
            notes=[],
        ))

    fixture = dict(
        id='demo-moonboat-midi-v1',
        name='月亮船(快乐星球)-王英姿',
        duration=song_duration,
        tracks=output_tracks,
    )

    out_file = Path(__file__).resolve().parents[1] / 'miniprogram/assets/demo-moonboat.json'
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
