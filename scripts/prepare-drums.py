"""Fetch enoe's CC BY 3.0 Pearl Master Studio recordings as mono 44.1 kHz PCM16 WAV files.
Run from the project root: python3 scripts/prepare-drums.py
See miniprogram/assets/drums/CREDITS.md for source and license.
"""
from pathlib import Path
import array
import io
import sys
import urllib.request
import wave

SOURCE = 'https://oramics.github.io/sampled/DRUMS/pearl-master-studio/samples/'
FILES = ['snare-01', 'tom-01', 'hihat-closed', 'hihat-open', 'crash-01', 'ride-01', 'tom-02', 'tom-03', 'kick-01', 'snare-02', 'crash-02', 'splash-01']
DEST = Path(__file__).resolve().parents[1] / 'miniprogram/assets/drums'
DEST.mkdir(parents=True, exist_ok=True)
for name in sys.argv[1:] or FILES:
    if name not in FILES:
        raise ValueError('Unknown drum sample: ' + name)
    with urllib.request.urlopen(SOURCE + name + '.wav') as response:
        data = response.read()
    with wave.open(io.BytesIO(data)) as wav:
        assert wav.getsampwidth() == 2 and wav.getframerate() == 44100
        channels = wav.getnchannels()
        samples = array.array('h', wav.readframes(wav.getnframes()))
    if sys.byteorder != 'little':
        samples.byteswap()
    mono = [sum(samples[i:i + channels]) / channels for i in range(0, len(samples), channels)]
    scale = 0.85 * 32767 / max(abs(value) for value in mono)
    output = array.array('h', (round(value * scale) for value in mono))
    if sys.byteorder != 'little':
        output.byteswap()
    with wave.open(str(DEST / (name + '.wav')), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        wav.writeframes(output.tobytes())
    print(name, len(output), 'frames')
