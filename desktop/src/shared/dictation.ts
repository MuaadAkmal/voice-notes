import type { Dictation } from './channels';
import { normalize } from './search';

/** Dictations are kept this long, then pruned. */
export const DICTATION_TTL_MS = 24 * 60 * 60_000;
/** Shorter clips are accidental taps: dropped without a request. */
export const MIN_DICTATION_MS = 500;

/** Accent- and case-insensitive match on the text and the app label. */
export function filterDictations(list: Dictation[], query: string): Dictation[] {
  const q = normalize(query.trim());
  if (!q) return list;
  return list.filter((d) => normalize(d.text).includes(q) || (d.app !== null && normalize(d.app).includes(q)));
}

/** Same keys, in any order. */
export const sameCombo = (a: number[], b: number[]) =>
  a.length === b.length && a.every((k) => b.includes(k));
