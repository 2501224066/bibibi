"""Convert Merry Christmas Mr. Lawrence MIDI to a full-length app fixture for bibibi.
Usage: python3 scripts/prepare-lawrence.py "/Users/zhangjing/Downloads/Merry Christmas Mr. Lawrence圣诞快乐，劳伦斯先生(战场上的圣诞快乐).mid"
"""
import bisect
import json
import struct
import sys
from collections import defaultdict, deque
from pathlib import Path


def main():
    source = Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/zhangjing/Downloads/Merry Christmas Mr. Lawrence圣诞快乐，劳伦斯先生(战场上的圣诞快乐).mid')
    data = source.read_bytes()
    assert data[:4] == b'MThd', 'Not a Standard MIDI File'
    fmt, count, ppqn = struct.unpack('>HHH', data[8:14])
    assert fmt in (0, 1) and not ppqn & 0x8000, 'Requires metrical format 0/1 MIDI'
    position = 8 + int.from_bytes(data[4:8], 'big')

    tempos = [(0, 750000)]
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
                    track_name = payload.decode('utf-8', 'replace')
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

    # Track 0: Right Hand (Piano melody & upper arpeggios)
    # Track 1: Left Hand (Piano bassline & chord harmonies)
    # Track 2-4: Empty placeholder tracks
    output_tracks = []
    all_end_times = []

    for track_index in (0, 1):
        name, events = tracks_events[track_index]
        active = defaultdict(deque)
        notes = []

        for tick, kind, channel, values in events:
            if tick < earliest_tick:
                continue
            pitch = values[0]
            velocity = values[1] if len(values) > 1 else 0

            if kind == 9 and velocity > 0:
                active[pitch].append((tick, velocity))
            elif kind == 8 or (kind == 9 and velocity == 0):
                queue = active[pitch]
                if not queue:
                    continue
                start_tick, start_vel = queue.popleft()
                start_ms = round(milliseconds(start_tick) - offset_ms, 3)
                end_ms = round(milliseconds(tick) - offset_ms, 3)
                duration_ms = round(max(10.0, end_ms - start_ms), 3)
                # Dynamics scale: piano expression preserved with balanced headroom
                v = round((start_vel / 127.0) * 0.75, 6)
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
            instrument='piano',
            duration=0,
            checked=True,
            loop=False,
            notes=notes,
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
        id='demo-lawrence-midi-v1',
        name='战场上的圣诞节-坂本龙一',
        duration=song_duration,
        tracks=output_tracks,
    )

    out_file = Path(__file__).resolve().parents[1] / 'miniprogram/assets/demo-lawrence.json'
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
