#!/usr/bin/env python3
"""Generate a short CC0 placeholder WAV (soft tone pattern) for demo listening items.

Usage: python3 tools/make_placeholder_audio.py OUTPUT.wav [--seconds 8]
No third-party dependencies. The file is only a stand-in so the player and the
byte-range code can be exercised; replace it with a real recording for study.
"""
import argparse, math, struct, wave

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('output')
    p.add_argument('--seconds', type=float, default=8.0)
    a = p.parse_args()
    rate = 22050
    frames = bytearray()
    notes = [392.0, 440.0, 494.0, 523.0, 494.0, 440.0]
    total = int(rate * a.seconds)
    for i in range(total):
        t = i / rate
        beat = int(t * 1.5) % len(notes)
        local = (t * 1.5) % 1.0
        env = min(1.0, local * 8) * max(0.0, 1.0 - local) ** 1.5
        v = 0.18 * env * math.sin(2 * math.pi * notes[beat] * t)
        frames += struct.pack('<h', int(v * 32767))
    with wave.open(a.output, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(frames))
    print('wrote', a.output, f'{a.seconds:.0f}s')

if __name__ == '__main__':
    main()
