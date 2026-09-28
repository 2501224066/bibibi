"""Prepare local piano samples; requires macOS afconvert. Run from project root.
Sources and CC BY 3.0 attribution: miniprogram/assets/piano/CREDITS.md.
"""
from pathlib import Path
import array
import subprocess
import sys
import tempfile
import urllib.request
import wave

DEST = Path(__file__).resolve().parents[1] / 'miniprogram/assets/piano'
DEST.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as scratch:
    for name in ['C3', 'Fs3', 'C4', 'Fs4', 'C5', 'Fs5', 'C6']:
        source = Path(scratch) / (name + '.mp3')
        converted = Path(scratch) / (name + '.wav')
        urllib.request.urlretrieve('https://tonejs.github.io/audio/salamander/' + name + '.mp3', source)
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', str(source), str(converted)], check=True)
        with wave.open(str(converted), 'rb') as wav:
            assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 22050)
            pcm = array.array('h', wav.readframes(wav.getnframes()))
        if sys.byteorder != 'little':
            pcm.byteswap()
        # Remove encoder/recording lead-in, keep three seconds and fade the last 180 ms.
        peak = max(abs(value) for value in pcm)
        start = next(i for i, value in enumerate(pcm) if abs(value) > peak * .004)
        pcm = pcm[max(0, start - 22):max(0, start - 22) + 3 * 22050]
        scale = .8 * 32767 / max(abs(value) for value in pcm)
        fade = int(.18 * 22050)
        output = array.array('h', (round(value * scale * min(1, (len(pcm) - 1 - i) / fade)) for i, value in enumerate(pcm)))
        if sys.byteorder != 'little':
            output.byteswap()
        with wave.open(str(DEST / (name + '.wav')), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(22050)
            wav.writeframes(output.tobytes())
        print(name, len(output), 'frames', flush=True)
