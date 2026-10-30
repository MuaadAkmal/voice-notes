import { describe, expect, it } from 'vitest';
import { chargedSeconds, wavInfo } from '../../../src/shared/asr/wav-info';
import { encodeWav } from '../../../src/shared/wav';

const tone = (seconds: number, rate = 16000) =>
  encodeWav(new Float32Array(Math.round(seconds * rate)).fill(0.1), rate);

describe('wavInfo', () => {
  it('reads a 16 kHz mono clip', () => {
    const info = wavInfo(tone(1.5))!;
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataOffset).toBe(44);
    expect(info.dataBytes).toBe(48000);
    expect(info.seconds).toBe(1.5);
  });

  it('skips non-data chunks', () => {
    const w = tone(1.5);
    const list = new Uint8Array([
      ...'LIST'.split('').map((c) => c.charCodeAt(0)),
      3, 0, 0, 0, 1, 2, 3, 0, // 3 bytes + pad byte
    ]);
    const out = new Uint8Array(w.length + list.length);
    out.set(w.subarray(0, 36));
    out.set(list, 36);
    out.set(w.subarray(36), 36 + list.length);
    const info = wavInfo(out)!;
    expect(info.seconds).toBe(1.5);
    expect(info.dataOffset).toBe(44 + list.length);
  });

  it('rejects non-RIFF', () => {
    expect(wavInfo(new Uint8Array(100))).toBeNull();
  });

  it('rejects 8-bit', () => {
    const w = tone(1);
    new DataView(w.buffer).setUint16(34, 8, true);
    expect(wavInfo(w)).toBeNull();
  });
});

describe('chargedSeconds', () => {
  it('rounds up, minimum 1', () => {
    expect(chargedSeconds(0.2)).toBe(1);
    expect(chargedSeconds(60.01)).toBe(61);
  });
});
