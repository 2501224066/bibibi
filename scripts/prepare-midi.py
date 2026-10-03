"""Convert the supplied Rainbow MIDI to a full-length app fixture.
Usage: python3 scripts/prepare-midi.py /path/to/彩虹-周杰伦.mid
No quantization or transposition; this fixture maps flute to synth and piano to piano.
"""
import bisect
import json
import struct
import sys
from collections import defaultdict, deque
from pathlib import Path

source = Path(sys.argv[1])
data = source.read_bytes()
assert data[:4] == b'MThd', 'Not a Standard MIDI File'
fmt, count, ppqn = struct.unpack('>HHH', data[8:14])
assert fmt in (0, 1) and not ppqn & 0x8000, 'Requires metrical format 0/1 MIDI'
position = 8 + int.from_bytes(data[4:8], 'big')
events = []
tempos = [(0, 500000)]
for track in range(count):
    assert data[position:position + 4] == b'MTrk'
    size = int.from_bytes(data[position + 4:position + 8], 'big')
    body = data[position + 8:position + 8 + size]
    position += 8 + size
    cursor = tick = status = 0

    def vlq():
        global cursor
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
        elif byte in (240, 247):
            length = vlq()
            cursor += length
            status = 0
        else:
            status = byte
            kind, channel = byte >> 4, byte & 15
            length = 1 if kind in (12, 13) else 2
            values = tuple(body[cursor:cursor + length])
            cursor += length
            events.append((tick, track, kind, channel, values))

tempo_map = dict(tempos)
tempo_ticks = sorted(tempo_map)
tempo_ms = [0.0]
for previous, current in zip(tempo_ticks, tempo_ticks[1:]):
    tempo_ms.append(tempo_ms[-1] + (current - previous) * tempo_map[previous] / ppqn / 1000)


def milliseconds(tick):
    index = bisect.bisect_right(tempo_ticks, tick) - 1
    return tempo_ms[index] + (tick - tempo_ticks[index]) * tempo_map[tempo_ticks[index]] / ppqn / 1000


# The source has no pedal or pitch bends. Fail instead of silently dropping those effects.
assert not any(kind == 11 and values[0] == 64 and values[1] >= 64 for _, _, kind, _, values in events), 'Sustain needs explicit conversion'
assert not any(kind == 14 and values != (0, 64) for _, _, kind, _, values in events), 'Pitch bend needs explicit conversion'
active = defaultdict(deque)
notes = defaultdict(list)
volumes = defaultdict(lambda: 1.0)
programs = {}
for tick, track, kind, channel, values in sorted(events, key=lambda event: (event[0], event[1])):
    if kind == 12:
        programs[channel] = values[0]
    elif kind == 11 and values[0] == 7:
        volumes[channel] = values[1] / 127
    elif kind == 9 and values[1]:
        active[track, channel, values[0]].append((tick, values[1] / 127 * volumes[channel]))
    elif kind == 8 or kind == 9 and not values[1]:
        queue = active[track, channel, values[0]]
        if not queue:
            continue
        start_tick, velocity = queue.popleft()
        start = milliseconds(start_tick)
        end = milliseconds(tick)
        if end <= start or not velocity:
            continue
        pitch = values[0]
        # Index is only for the nine-zone visualization; midiNote drives exact playback.
        index = [6, 6, 7, 7, 8, 0, 0, 1, 1, 2, 2, 3][pitch % 12]
        notes[track, channel].append(dict(index=index, midiNote=pitch, start=round(start, 3),
            duration=round(end - start, 3), octave=max(0, min(2, (pitch - 48) // 12)),
            velocity=round(velocity, 6), vibrato=False))
assert not any(active.values()), 'Unterminated notes in source'
duration = round(max(note['start'] + note['duration'] for sequence in notes.values() for note in sequence), 3)
tracks = []
for (track, channel), sequence in sorted(notes.items()):
    program = programs.get(channel, 0)
    assert channel != 9 and program in (0, 73), f'Unexpected instrument {program}'
    sequence.sort(key=lambda note: note['start'])
    tracks.append(dict(instrument='synth' if program == 73 else 'piano', duration=duration,
                       checked=True, loop=False, notes=sequence))
assert len(tracks) <= 5
while len(tracks) < 5:
    tracks.append(dict(instrument=None, duration=0, notes=[]))
fixture = dict(id='demo-rainbow-midi-v1', name='彩虹-周杰伦', duration=duration, tracks=tracks)
output = Path(__file__).resolve().parents[1] / 'miniprogram/assets/demo-rainbow.json'
output.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(json.dumps(dict(source=source.name, sourceSeconds=round(milliseconds(max(event[0] for event in events)) / 1000, 2),
                     output=str(output), noteCounts=[len(track['notes']) for track in tracks]), ensure_ascii=False))
