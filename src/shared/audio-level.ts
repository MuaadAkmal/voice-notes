const FLOOR_DB = -60;
const CEILING_DB = -10;
const SILENCE_DB = -50;

const toDb = (rms: number) => (rms > 0 ? 20 * Math.log10(rms) : -Infinity);

/** Root mean square of raw samples (-1..1). */
export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** Bar height 0..1: linear in dB between a quiet floor and a loud ceiling, so normal speech fills the range. */
export function levelFromRms(rms: number): number {
  const level = (toDb(rms) - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
  return Math.min(1, Math.max(0, level));
}

export function isSilent(rms: number): boolean {
  return toDb(rms) < SILENCE_DB;
}
