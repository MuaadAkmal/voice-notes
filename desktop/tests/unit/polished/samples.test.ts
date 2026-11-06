import { describe, expect, it } from 'vitest';
import { joinWavs, pickSamples } from '../../../src/main/polished/samples';
import type { Note } from '../../../src/shared/channels';
import { silentWav } from '../../../src/shared/wav';

const note = (id: string, seconds: number, over: Partial<Note> = {}): Note =>
  ({ id, durationMs: seconds * 1000, source: 'mic', kind: 'note', status: 'ok', pageId: null, ...over }) as Note;

describe('pickSamples', () => {
  it('takes the longest mic notes until the target', () => {
    const picked = pickSamples([note('a', 30), note('b', 90), note('c', 60), note('d', 50)]);
    expect(picked.map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('stops by 180 s', () => {
    const picked = pickSamples([note('a', 100), note('b', 100), note('c', 100)], 400_000);
    expect(picked.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('skips rewinds, remote, system, missing and page-owned notes', () => {
    const picked = pickSamples([
      note('r', 100, { kind: 'rewind' }),
      note('x', 100, { status: 'remote' }),
      note('s', 100, { source: 'system' }),
      note('m', 100, { status: 'missing' }),
      note('p', 100, { pageId: 'pg' }),
      note('ok', 10),
    ]);
    expect(picked.map((n) => n.id)).toEqual(['ok']);
  });

  it('returns what it has when short', () => {
    expect(pickSamples([note('a', 10), note('b', 5)]).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('joinWavs', () => {
  const dataBytes = (w: Uint8Array) => new DataView(w.buffer, w.byteOffset).getUint32(40, true);

  it('joins the data under one header', () => {
    const out = joinWavs([silentWav(2), silentWav(3)]);
    const v = new DataView(out.buffer, out.byteOffset);
    expect(out.length).toBe(44 + 5 * 32000);
    expect(dataBytes(out)).toBe(5 * 32000);
    expect(v.getUint32(4, true)).toBe(36 + 5 * 32000);
    expect(v.getUint32(24, true)).toBe(16000);
  });

  it('caps at 180 s, cutting the last piece', () => {
    const out = joinWavs([silentWav(100), silentWav(100)]);
    expect(dataBytes(out)).toBe(180 * 32000);
    expect(out.length).toBe(44 + 180 * 32000);
  });
});
