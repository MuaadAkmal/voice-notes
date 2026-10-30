import { describe, expect, it, vi } from 'vitest';
import { AsrCore, BadAudio, ProviderFailed, QuotaExceeded, TooLarge } from '../../../src/shared/asr/core';
import { MemoryAsrStore } from '../../../src/shared/asr/store';

const U = '11111111-1111-4111-8111-111111111111';

function wav(seconds: number, rate = 16000): Uint8Array {
  const dataBytes = Math.round(seconds * rate) * 2;
  const b = new Uint8Array(44 + dataBytes);
  const v = new DataView(b.buffer);
  const s = (at: number, t: string) => [...t].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  s(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  s(8, 'WAVE');
  s(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s(36, 'data');
  v.setUint32(40, dataBytes, true);
  return b;
}

function setup(nowIso = '2026-10-15T12:00:00Z') {
  const store = new MemoryAsrStore();
  let now = Date.parse(nowIso);
  const transcribe = vi.fn(async (_w: Uint8Array, _l: string | null) => ({ text: 'hello', language: 'en' as string | null }));
  const core = new AsrCore({ store, transcribe, now: () => now });
  return { store, transcribe, core, setNow: (t: number) => (now = t) };
}

describe('AsrCore', () => {
  it('transcribes and charges whole seconds', async () => {
    const { core, transcribe } = setup();
    const r = await core.transcribe(U, wav(2.3), 'en');
    expect(r).toEqual({ text: 'hello', language: 'en', seconds: 3, used: 3, limit: 7200, resetsAt: '2026-11-01T00:00:00.000Z' });
    expect(transcribe.mock.calls[0][1]).toBe('en');
    expect(await core.usage(U)).toEqual({ used: 3, limit: 7200, resetsAt: '2026-11-01T00:00:00.000Z', plan: 'free' });
  });

  it('non-WAV is BadAudio and touches nothing', async () => {
    const { core, store, transcribe } = setup();
    const reserve = vi.spyOn(store, 'reserve');
    await expect(core.transcribe(U, new Uint8Array(64).fill(7), null)).rejects.toBeInstanceOf(BadAudio);
    expect(reserve).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('301 s is TooLarge', async () => {
    const { core, store } = setup();
    const reserve = vi.spyOn(store, 'reserve');
    await expect(core.transcribe(U, wav(301, 8000), null)).rejects.toBeInstanceOf(TooLarge);
    expect(reserve).not.toHaveBeenCalled();
  });

  it('a header declaring 1 s on a 60 s body is charged 1 s and forwards exactly 1 s', async () => {
    const { core, transcribe } = setup();
    const body = wav(60);
    new DataView(body.buffer).setUint32(40, 32000, true); // data chunk claims 1 s
    const r = await core.transcribe(U, body, null);
    expect(r.seconds).toBe(1);
    const sent = transcribe.mock.calls[0][0];
    expect(sent.length).toBe(44 + 32000);
    expect([...sent.subarray(0, 44)]).toEqual([...wav(1).subarray(0, 44)]);
  });

  it.each([
    [7999, 1],
    [48001, 1],
    [16000, 3],
  ])('rate %i, %i channels is BadAudio', async (rate, ch) => {
    const { core, transcribe } = setup();
    const body = wav(1, rate);
    const v = new DataView(body.buffer);
    v.setUint16(22, ch, true);
    await expect(core.transcribe(U, body, null)).rejects.toBeInstanceOf(BadAudio);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('over 10 MB is TooLarge', async () => {
    const { core } = setup();
    await expect(core.transcribe(U, new Uint8Array(10 * 1024 * 1024 + 1), null)).rejects.toBeInstanceOf(TooLarge);
  });

  it('quota refused is QuotaExceeded and the transcriber is never called', async () => {
    const { core, store, transcribe } = setup();
    await store.reserve(U, '2026-10-01', 7199);
    const e = await core.transcribe(U, wav(2), null).catch((x) => x);
    expect(e).toBeInstanceOf(QuotaExceeded);
    expect((e as QuotaExceeded).resetsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(transcribe).not.toHaveBeenCalled();
    expect((await core.usage(U)).used).toBe(7199);
  });

  it('a provider failure refunds', async () => {
    const { core, transcribe } = setup();
    await core.transcribe(U, wav(1), null);
    transcribe.mockRejectedValueOnce(new Error('boom'));
    await expect(core.transcribe(U, wav(5), null)).rejects.toBeInstanceOf(ProviderFailed);
    expect((await core.usage(U)).used).toBe(1);
  });

  it('refund uses reservation period', async () => {
    const { core, store, transcribe, setNow } = setup('2026-10-31T23:59:59.5Z');
    transcribe.mockImplementationOnce(async () => {
      setNow(Date.parse('2026-11-01T00:00:01Z'));
      throw new Error('late');
    });
    await store.reserve(U, '2026-10-01', 100);
    await expect(core.transcribe(U, wav(4), null)).rejects.toBeInstanceOf(ProviderFailed);
    expect((await store.usage(U, '2026-10-01')).used).toBe(100);
    expect((await store.usage(U, '2026-11-01')).used).toBe(0);
  });
});
