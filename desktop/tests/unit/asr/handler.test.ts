import { expect, it } from 'vitest';
import { BadAudio, ProviderFailed, QuotaExceeded, TooLarge, type AsrCore } from '../../../src/shared/asr/core';
import { handleAsr } from '../../../src/shared/asr/handler';
import { MAX_BYTES } from '../../../src/shared/asr/protocol';

const ok = { transcribe: async (_u: string, _b: Uint8Array, lang: string | null) => ({ text: 't', language: lang, seconds: 1, used: 1, limit: 2, resetsAt: 'r' }), usage: async () => ({ used: 0, limit: 7200, resetsAt: 'r', plan: 'free' }) };
const mk = (core: Partial<typeof ok> | null, missing: string[] = []) => ({
  core: core as unknown as AsrCore | null,
  verify: async (jwt: string) => (jwt === 'good' ? { userId: 'u1' } : null),
  missing,
});
const req = (path: string, init: RequestInit = {}, token: string | null = 'good') =>
  new Request(`https://x.test/functions/v1/asr/${path}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as object) },
  });
const post = (token: string | null = 'good', body: BodyInit = new Uint8Array(4)) => req('transcribe?language=en', { method: 'POST', body }, token);

it('transcribes with the verified user and language', async () => {
  const r = await handleAsr(post(), mk(ok));
  expect(r.status).toBe(200);
  expect((await r.json()).language).toBe('en');
});

it('reports usage', async () => {
  const r = await handleAsr(req('usage'), mk(ok));
  expect(await r.json()).toMatchObject({ used: 0, limit: 7200 });
});

it('401 without or with a bad token', async () => {
  expect((await handleAsr(post(null), mk(ok))).status).toBe(401);
  expect((await handleAsr(post('bad'), mk(ok))).status).toBe(401);
});

it('413 on a large Content-Length before reading the body', async () => {
  const r = req('transcribe', { method: 'POST', body: new Uint8Array(4), headers: { 'content-length': String(MAX_BYTES + 1) } });
  const called = { n: 0 };
  const res = await handleAsr(r, mk({ ...ok, transcribe: async () => { called.n++; return ok.transcribe('', new Uint8Array(), null); } }));
  expect(res.status).toBe(413);
  expect(called.n).toBe(0);
});

it('413 on a large body without a header', async () => {
  const big = new Uint8Array(MAX_BYTES + 1);
  const r = req('transcribe', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }), duplex: 'half' } as RequestInit);
  expect((await handleAsr(r, mk(ok))).status).toBe(413);
});

it.each([
  [new BadAudio('secret'), 400, 'bad_audio'],
  [new TooLarge('secret'), 413, 'too_large'],
  [new ProviderFailed('secret upstream text'), 502, 'provider_failed'],
  [new Error('secret'), 500, 'Server error'],
])('maps %s without echoing its message', async (err, status, code) => {
  const r = await handleAsr(post(), mk({ ...ok, transcribe: async () => { throw err; } }));
  expect(r.status).toBe(status);
  const text = await r.text();
  expect(JSON.parse(text).error).toBe(code);
  expect(text).not.toContain('secret');
});

it('429 carries resetsAt', async () => {
  const r = await handleAsr(post(), mk({ ...ok, transcribe: async () => { throw new QuotaExceeded('2026-11-01T00:00:00.000Z'); } }));
  expect(r.status).toBe(429);
  expect(await r.json()).toEqual({ error: 'quota_exceeded', resetsAt: '2026-11-01T00:00:00.000Z' });
});

it('500 misconfigured lists the missing secrets', async () => {
  const r = await handleAsr(post(), mk(null, ['ELEVENLABS_API_KEY']));
  expect(r.status).toBe(500);
  expect(await r.json()).toEqual({ error: 'misconfigured', missing: ['ELEVENLABS_API_KEY'] });
});

it('404 on an unknown route', async () => {
  expect((await handleAsr(req('nope', { method: 'POST' }), mk(ok))).status).toBe(404);
  expect((await handleAsr(req('transcribe', { method: 'GET' }), mk(ok))).status).toBe(404);
});
