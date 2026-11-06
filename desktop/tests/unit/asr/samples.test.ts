import { describe, expect, it, vi } from 'vitest';
import { ProviderFailed } from '../../../src/shared/asr/core';
import { STOCK_VOICES } from '../../../src/shared/asr/protocol';
import { SampleCore, UnknownVoice, type SampleStore } from '../../../src/shared/asr/samples';

function setup(mp3: Uint8Array = new Uint8Array([1, 2, 3])) {
  const rows = new Map<string, Uint8Array>();
  const store: SampleStore = {
    get: vi.fn(async (id: string) => rows.get(id) ?? null),
    put: vi.fn(async (id: string, b: Uint8Array) => void rows.set(id, b)),
  };
  const speaker = vi.fn(async (_v: string, _t: string, _s: AbortSignal) => mp3);
  return { rows, store, speaker, core: new SampleCore({ store, speaker }) };
}
const V = STOCK_VOICES[1];

describe('SampleCore.sample', () => {
  it('makes a stock voice once, says its name, and keeps it', async () => {
    const { core, speaker, store } = setup();
    expect(await core.sample(V.id)).toEqual(new Uint8Array([1, 2, 3]));
    expect(speaker).toHaveBeenCalledWith(V.id, `Hi, I'm ${V.name}. This is how your notes will sound.`, expect.any(AbortSignal));
    expect(store.put).toHaveBeenCalledWith(V.id, new Uint8Array([1, 2, 3]));
  });
  it('serves a kept sample without speaking again', async () => {
    const { core, speaker, rows } = setup();
    rows.set(V.id, new Uint8Array([9]));
    expect(await core.sample(V.id)).toEqual(new Uint8Array([9]));
    expect(speaker).not.toHaveBeenCalled();
  });
  it('generates once for concurrent first requests', async () => {
    const { core, speaker, store } = setup();
    const all = await Promise.all([core.sample(V.id), core.sample(V.id), core.sample(V.id)]);
    expect(all.every((b) => b.length === 3)).toBe(true);
    expect(speaker).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledTimes(1);
  });
  it('refuses a voice that is not a stock voice', async () => {
    const { core, speaker } = setup();
    await expect(core.sample('clone')).rejects.toBeInstanceOf(UnknownVoice);
    await expect(core.sample('../x')).rejects.toBeInstanceOf(UnknownVoice);
    expect(speaker).not.toHaveBeenCalled();
  });
  it('an empty result is a provider failure and is not kept', async () => {
    const { core, store } = setup(new Uint8Array(0));
    await expect(core.sample(V.id)).rejects.toBeInstanceOf(ProviderFailed);
    expect(store.put).not.toHaveBeenCalled();
  });
  it('a speaker failure is a provider failure, and the next request tries again', async () => {
    const { core, speaker } = setup();
    speaker.mockRejectedValueOnce(new Error('down'));
    await expect(core.sample(V.id)).rejects.toBeInstanceOf(ProviderFailed);
    expect((await core.sample(V.id)).length).toBe(3);
  });
});
