import { describe, expect, it } from 'vitest';
import { splitWav } from '../../../src/shared/asr/chunk';
import { wavInfo } from '../../../src/shared/asr/wav-info';
import { encodeWav } from '../../../src/shared/wav';

const RATE = 4000;
const noise = (seconds: number) => {
  const s = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < s.length; i++) s[i] = 0.3 * (i % 2 ? 1 : -1);
  return s;
};

describe('splitWav', () => {
  it('leaves a short clip alone', () => {
    const w = encodeWav(noise(200), RATE);
    const parts = splitWav(w);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(w);
  });

  it('splits 700 s into 3 parts that add up', () => {
    const parts = splitWav(encodeWav(noise(700), RATE));
    expect(parts).toHaveLength(3);
    let sum = 0;
    for (const p of parts) {
      const s = wavInfo(p)!.seconds;
      expect(s).toBeLessThanOrEqual(300);
      sum += s;
    }
    expect(sum).toBeCloseTo(700, 5);
  });

  it('cuts inside the quiet gap', () => {
    const s = noise(400);
    s.fill(0, Math.round(295 * RATE), Math.round(295.5 * RATE));
    const parts = splitWav(encodeWav(s, RATE));
    expect(parts).toHaveLength(2);
    const cut = wavInfo(parts[0])!.seconds;
    expect(cut).toBeGreaterThanOrEqual(295);
    expect(cut).toBeLessThanOrEqual(295.5);
  });
});
