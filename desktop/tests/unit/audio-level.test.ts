import { expect, it } from 'vitest';
import { anyAudible, isSilent, levelFromRms, rmsOf } from '../../src/shared/audio-level';

const db = (d: number) => 10 ** (d / 20);

it('levelFromRms maps -60 dBFS and below to 0', () => {
  expect(levelFromRms(0)).toBe(0);
  expect(levelFromRms(db(-60))).toBe(0);
  expect(levelFromRms(db(-80))).toBe(0);
});

it('levelFromRms maps -10 dBFS and above to 1', () => {
  expect(levelFromRms(db(-10))).toBeCloseTo(1, 6);
  expect(levelFromRms(1)).toBe(1);
});

it('levelFromRms is linear in dB between floor and ceiling', () => {
  expect(levelFromRms(db(-35))).toBeCloseTo(0.5, 3);
});

it('isSilent uses a -50 dBFS threshold', () => {
  expect(isSilent(db(-51))).toBe(true);
  expect(isSilent(db(-49))).toBe(false);
});

it('rmsOf a ±0.5 square wave is 0.5', () => {
  const samples = Float32Array.from({ length: 64 }, (_, i) => (i % 2 ? 0.5 : -0.5));
  expect(rmsOf(samples)).toBeCloseTo(0.5, 6);
});

it('anyAudible finds one loud window among silent ones', () => {
  const quiet = new Float32Array(4800).fill(0.0001);
  expect(anyAudible(quiet, 2400)).toBe(false);
  const loud = quiet.slice();
  loud.fill(0.2, 3000, 3600); // a short burst in the second window
  expect(anyAudible(loud, 2400)).toBe(true);
  expect(anyAudible(new Float32Array(0), 2400)).toBe(false);
});
