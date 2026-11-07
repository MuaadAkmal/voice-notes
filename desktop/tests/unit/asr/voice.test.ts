import { describe, expect, it, vi } from 'vitest';
import { ProviderFailed } from '../../../src/shared/asr/core';
import { STOCK_VOICES } from '../../../src/shared/asr/protocol';
import { MemoryAsrStore } from '../../../src/shared/asr/store';
import { BadSamples, CloneRefused, CloneUnavailableNow, NeedsPaidPlan, NoConsent, VoiceCore, cloneLimitFor, type CloneStore, type VoiceApi } from '../../../src/shared/asr/voice';
import { silentWav } from '../../../src/shared/wav';

const A = '11111111-1111-4111-8111-111111111111';
const B = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-15T12:00:00Z');

class MemoryClones implements CloneStore {
  rows = new Map<string, string>();
  async get(user: string) {
    return this.rows.get(user) ?? null;
  }
  async count() {
    return this.rows.size;
  }
  async put(user: string, id: string) {
    const old = this.rows.get(user) ?? null;
    this.rows.set(user, id);
    return old;
  }
  async remove(user: string) {
    const old = this.rows.get(user) ?? null;
    this.rows.delete(user);
    return old;
  }
}

function setup(opts: { limit?: number; paid?: boolean; plan?: string } = {}) {
  const store = new MemoryAsrStore();
  if (opts.paid ?? true) store.setPlan(A, opts.plan ?? 'pro', 7200);
  const clones = new MemoryClones();
  const api = {
    create: vi.fn(async (_n: string, _w: Uint8Array) => 'new-voice'),
    remove: vi.fn(async (_id: string) => {}),
  } satisfies VoiceApi;
  const core = new VoiceCore({ store, clones, api, limit: opts.limit ?? 5, now: () => NOW });
  return { store, clones, api, core };
}
const good = silentWav(40, 8000);

describe('VoiceCore.state', () => {
  it('lists the stock voices', async () => {
    const { core } = setup();
    const s = await core.state(A);
    expect(s.stock.map((v) => v.id)).toEqual(STOCK_VOICES.map((v) => v.id));
    expect(s.stock[0]).toEqual({ id: STOCK_VOICES[0].id, name: STOCK_VOICES[0].name });
  });
  it('Free: cannot clone, no clone', async () => {
    const { core } = setup({ paid: false });
    expect(await core.state(A)).toMatchObject({ canClone: false, clone: 'none', plan: 'free' });
  });
  it('paid with room can clone', async () => {
    const { core } = setup();
    expect(await core.state(A)).toMatchObject({ canClone: true, clone: 'none', plan: 'pro' });
  });
  it('paid at the limit cannot clone, unless it already has a clone', async () => {
    const { core, clones } = setup({ limit: 1 });
    clones.rows.set(B, 'other');
    expect((await core.state(A)).canClone).toBe(false);
    clones.rows.set(A, 'mine');
    expect(await core.state(A)).toMatchObject({ canClone: true, clone: 'ready' });
  });
  it('limit 0 means unavailable', async () => {
    const { core } = setup({ limit: 0 });
    expect((await core.state(A)).canClone).toBe(false);
  });
  it('Free with a saved clone is unusable', async () => {
    const { core, clones } = setup({ paid: false });
    clones.rows.set(A, 'mine');
    expect(await core.state(A)).toMatchObject({ clone: 'unusable', canClone: false });
  });
});

describe('cloneLimitFor', () => {
  it('keeps one slot spare and treats junk as off', () => {
    expect(cloneLimitFor(10)).toBe(9);
    expect(cloneLimitFor(1)).toBe(0);
    expect(cloneLimitFor(0)).toBe(0);
    expect(cloneLimitFor(Number.NaN)).toBe(0);
    expect(cloneLimitFor(160)).toBe(159);
    expect(cloneLimitFor(-4)).toBe(0);
    expect(cloneLimitFor(2.7)).toBe(1);
  });
});

describe('Pro only', () => {
  it('Standard cannot clone, and a clone it holds is unusable', async () => {
    const { core, clones, api } = setup({ plan: 'standard' });
    expect(await core.state(A)).toMatchObject({ canClone: false, clone: 'none', plan: 'standard' });
    await expect(core.clone(A, good, true)).rejects.toBeInstanceOf(NeedsPaidPlan);
    expect(api.create).not.toHaveBeenCalled();
    clones.rows.set(A, 'mine');
    expect(await core.state(A)).toMatchObject({ clone: 'unusable', canClone: false });
    expect(await core.usableClone(A)).toBeNull();
  });
  it('Pro can clone', async () => {
    const { core } = setup();
    expect((await core.state(A)).canClone).toBe(true);
    expect((await core.clone(A, good, true)).clone).toBe('ready');
  });
  it('logs when the slots are full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = setup({ limit: 1 });
    full.clones.rows.set(B, 'other');
    await expect(full.core.clone(A, good, true)).rejects.toBeInstanceOf(CloneUnavailableNow);
    expect(warn).toHaveBeenCalledWith('[voice] clone slots full', { count: 1, limit: 1 });
    warn.mockClear();
    const refused = setup();
    refused.api.create.mockRejectedValueOnce(new CloneRefused('voice limit reached'));
    await expect(refused.core.clone(A, good, true)).rejects.toBeInstanceOf(CloneUnavailableNow);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('VoiceCore.clone', () => {
  it('needs consent', async () => {
    const { core, api } = setup();
    await expect(core.clone(A, good, false)).rejects.toBeInstanceOf(NoConsent);
    expect(api.create).not.toHaveBeenCalled();
  });
  it('needs a paid plan', async () => {
    const { core } = setup({ paid: false });
    await expect(core.clone(A, good, true)).rejects.toBeInstanceOf(NeedsPaidPlan);
  });
  it('refuses samples under 30 s, over 180 s, or not a WAV', async () => {
    const { core, api } = setup();
    await expect(core.clone(A, silentWav(10, 8000), true)).rejects.toBeInstanceOf(BadSamples);
    await expect(core.clone(A, silentWav(200, 8000), true)).rejects.toBeInstanceOf(BadSamples);
    await expect(core.clone(A, new Uint8Array(100), true)).rejects.toBeInstanceOf(BadSamples);
    expect(api.create).not.toHaveBeenCalled();
  });
  it('refuses at the limit', async () => {
    const { core, clones, api } = setup({ limit: 1 });
    clones.rows.set(B, 'other');
    await expect(core.clone(A, good, true)).rejects.toBeInstanceOf(CloneUnavailableNow);
    expect(api.create).not.toHaveBeenCalled();
  });
  it('creates, saves and returns ready', async () => {
    const { core, clones, api } = setup();
    const s = await core.clone(A, good, true);
    expect(s.clone).toBe('ready');
    expect(api.create).toHaveBeenCalledWith(`voice-notes-${A}`, good);
    expect(clones.rows.get(A)).toBe('new-voice');
  });
  it('replacing removes the old voice at ElevenLabs, even at the limit', async () => {
    const { core, clones, api } = setup({ limit: 1 });
    clones.rows.set(A, 'old-voice');
    const s = await core.clone(A, good, true);
    expect(s.clone).toBe('ready');
    expect(api.remove).toHaveBeenCalledWith('old-voice');
    expect(clones.rows.get(A)).toBe('new-voice');
  });
  it('a failed removal of the old voice does not fail the clone', async () => {
    const { core, clones, api } = setup();
    clones.rows.set(A, 'old-voice');
    api.remove.mockRejectedValue(new Error('x'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await core.clone(A, good, true)).clone).toBe('ready');
  });
  it('ElevenLabs refusing becomes CloneUnavailableNow; other failures ProviderFailed', async () => {
    const { core, clones, api } = setup();
    api.create.mockRejectedValueOnce(new CloneRefused('voice limit reached'));
    await expect(core.clone(A, good, true)).rejects.toBeInstanceOf(CloneUnavailableNow);
    api.create.mockRejectedValueOnce(new Error('boom'));
    await expect(core.clone(A, good, true)).rejects.toBeInstanceOf(ProviderFailed);
    expect(clones.rows.size).toBe(0);
  });
  it('removes the new voice if saving the row fails', async () => {
    const { core, clones, api } = setup();
    clones.put = async () => {
      throw new Error('db');
    };
    await expect(core.clone(A, good, true)).rejects.toThrow('db');
    expect(api.remove).toHaveBeenCalledWith('new-voice');
  });
});

describe('VoiceCore.remove', () => {
  it('deletes at ElevenLabs then the row, returns none', async () => {
    const { core, clones, api } = setup();
    clones.rows.set(A, 'mine');
    expect((await core.remove(A)).clone).toBe('none');
    expect(api.remove).toHaveBeenCalledWith('mine');
    expect(clones.rows.has(A)).toBe(false);
  });
  it('is fine with no clone', async () => {
    const { core, api } = setup();
    expect((await core.remove(A)).clone).toBe('none');
    expect(api.remove).not.toHaveBeenCalled();
  });
  it('keeps the row when ElevenLabs removal fails', async () => {
    const { core, clones, api } = setup();
    clones.rows.set(A, 'mine');
    api.remove.mockRejectedValue(new Error('down'));
    await expect(core.remove(A)).rejects.toBeInstanceOf(ProviderFailed);
    expect(clones.rows.has(A)).toBe(true);
  });
});

describe('VoiceCore.usableClone', () => {
  it('returns the id on a paid plan', async () => {
    const { core, clones } = setup();
    clones.rows.set(A, 'mine');
    expect(await core.usableClone(A)).toBe('mine');
  });
  it('null on Free even with a row, and with no row', async () => {
    const { core, clones } = setup({ paid: false });
    clones.rows.set(A, 'mine');
    expect(await core.usableClone(A)).toBeNull();
    expect(await setup().core.usableClone(A)).toBeNull();
  });
});
