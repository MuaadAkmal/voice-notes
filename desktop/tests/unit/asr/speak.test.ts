import { describe, expect, it, vi } from 'vitest';
import { ProviderFailed, QuotaExceeded } from '../../../src/shared/asr/core';
import { STOCK_VOICES } from '../../../src/shared/asr/protocol';
import { BadSpeak, CloneUnavailable, NotYourNote, SpeakCore, StorageFull, type SpeakFiles } from '../../../src/shared/asr/speak';
import { MemoryAsrStore } from '../../../src/shared/asr/store';

const A = '11111111-1111-4111-8111-111111111111';
const NOTE = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-15T12:00:00Z');
const PERIOD = '2026-10-01';
const voice = STOCK_VOICES[0].id;

function setup(opts: { bytes?: number; owns?: boolean; fits?: boolean; clone?: string | null } = {}) {
  const store = new MemoryAsrStore();
  const speaker = vi.fn(async (_v: string, _t: string, _s: AbortSignal) => new Uint8Array(opts.bytes ?? 32000));
  const calls: string[] = [];
  const files: SpeakFiles = {
    owns: async () => opts.owns ?? true,
    reserve: async () => opts.fits ?? true,
    upload: async (path) => void calls.push(path),
  };
  const core = new SpeakCore({ store, speaker, files, clone: async () => opts.clone ?? null, now: () => NOW });
  return { store, speaker, files, calls, core };
}
const text120 = 'x'.repeat(120); // estimate 10 s

describe('SpeakCore', () => {
  it("speaks a note: reserves the estimate, charges the measured seconds, uploads to the note's polished path", async () => {
    const { core, store, calls } = setup();
    const r = await core.speak(A, { noteId: NOTE, text: text120, voice });
    expect(calls).toEqual([`${A}/${NOTE}.polished.mp3`]);
    expect(r.seconds).toBe(2);
    expect(r.used).toBe(2);
    expect((await store.usage(A, PERIOD)).used).toBe(2);
  });

  it('charges no more than it reserved', async () => {
    const { core } = setup({ bytes: 16000 * 30 });
    const r = await core.speak(A, { noteId: NOTE, text: text120, voice });
    expect(r.seconds).toBe(10);
    expect(r.used).toBe(10);
  });

  it("refuses past the month's minutes", async () => {
    const { core, store, speaker } = setup();
    store.setPlan(A, 'free', 5);
    await expect(core.speak(A, { noteId: NOTE, text: text120, voice })).rejects.toBeInstanceOf(QuotaExceeded);
    expect(speaker).not.toHaveBeenCalled();
  });

  it('gives the minutes back when ElevenLabs or storage refuses', async () => {
    const a = setup();
    a.speaker.mockRejectedValueOnce(new Error('boom'));
    await expect(a.core.speak(A, { noteId: NOTE, text: text120, voice })).rejects.toBeInstanceOf(ProviderFailed);
    expect((await a.store.usage(A, PERIOD)).used).toBe(0);

    const b = setup({ fits: false });
    await expect(b.core.speak(A, { noteId: NOTE, text: text120, voice })).rejects.toBeInstanceOf(StorageFull);
    expect((await b.store.usage(A, PERIOD)).used).toBe(0);
    expect(b.calls).toEqual([]);
  });

  it('gives the charged seconds back when the upload fails', async () => {
    const { core, store, files } = setup();
    files.upload = async () => {
      throw new Error('disk');
    };
    await expect(core.speak(A, { noteId: NOTE, text: text120, voice })).rejects.toThrow('disk');
    expect((await store.usage(A, PERIOD)).used).toBe(0);
  });

  it("reads with the user's clone only while it's usable", async () => {
    const none = setup({ clone: null });
    await expect(none.core.speak(A, { noteId: NOTE, text: 'hello', voice: 'clone' })).rejects.toBeInstanceOf(CloneUnavailable);
    const ok = setup({ clone: 'v_me' });
    await ok.core.speak(A, { noteId: NOTE, text: 'hello', voice: 'clone' });
    expect(ok.speaker).toHaveBeenCalledWith('v_me', 'hello', expect.anything());
  });

  it("refuses a note that isn't the account's, an unknown voice, empty or too long text", async () => {
    await expect(setup({ owns: false }).core.speak(A, { noteId: NOTE, text: 'hi', voice })).rejects.toBeInstanceOf(NotYourNote);
    const { core } = setup();
    await expect(core.speak(A, { noteId: NOTE, text: 'hi', voice: 'nope' })).rejects.toBeInstanceOf(BadSpeak);
    await expect(core.speak(A, { noteId: NOTE, text: '   ', voice })).rejects.toBeInstanceOf(BadSpeak);
    await expect(core.speak(A, { noteId: NOTE, text: 'x'.repeat(5001), voice })).rejects.toBeInstanceOf(BadSpeak);
    await expect(core.speak(A, { noteId: 'bad/../id', text: 'hi', voice })).rejects.toBeInstanceOf(BadSpeak);
  });
});
