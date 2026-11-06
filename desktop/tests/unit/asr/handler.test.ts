import { expect, it } from 'vitest';
import { BadAudio, ProviderFailed, QuotaExceeded, TooLarge, type AsrCore } from '../../../src/shared/asr/core';
import { handleAsr } from '../../../src/shared/asr/handler';
import { MAX_BYTES } from '../../../src/shared/asr/protocol';
import { BadSpeak, CloneUnavailable, NotYourNote, StorageFull } from '../../../src/shared/asr/speak';
import { BadSamples, CloneUnavailableNow, NeedsPaidPlan, NoConsent } from '../../../src/shared/asr/voice';

const ok = { transcribe: async (_u: string, _b: Uint8Array, lang: string | null) => ({ text: 't', language: lang, seconds: 1, used: 1, limit: 2, resetsAt: 'r' }), usage: async () => ({ used: 0, limit: 7200, resetsAt: 'r', plan: 'free' }) };
const vstate = { stock: [], clone: 'none', canClone: true, plan: 'standard' };
const speaks = { speak: async () => ({ seconds: 3, used: 3, limit: 100, resetsAt: 'r' }) };
const voices = { state: async () => vstate, clone: async () => vstate, remove: async () => vstate };
const mk = (core: Partial<typeof ok> | null, missing: string[] = [], extra: { speak?: object | null; voice?: object | null } = {}) => ({
  core: core as unknown as AsrCore | null,
  speak: (extra.speak === undefined ? speaks : extra.speak) as never,
  voice: (extra.voice === undefined ? voices : extra.voice) as never,
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

it('passes custom words on as key terms, cleaned again', async () => {
  let seen: unknown = null;
  const core = { ...ok, transcribe: async (_u: string, _b: Uint8Array, _l: string | null, _c?: boolean, k?: string[]) => ((seen = k), ok.transcribe('', new Uint8Array(), null)) };
  const q = encodeURIComponent(JSON.stringify(['Muaad', 'a{b}']));
  expect((await handleAsr(req(`transcribe?keyterms=${q}`, { method: 'POST', body: new Uint8Array(4) }), mk(core))).status).toBe(200);
  expect(seen).toEqual(['Muaad', 'ab']);
});

it.each(['not json', '{"a":1}', '[1,2]', ''])('treats key terms %j as none', async (raw) => {
  let seen: unknown = null;
  const core = { ...ok, transcribe: async (_u: string, _b: Uint8Array, _l: string | null, _c?: boolean, k?: string[]) => ((seen = k), ok.transcribe('', new Uint8Array(), null)) };
  expect((await handleAsr(req(`transcribe?keyterms=${encodeURIComponent(raw)}`, { method: 'POST', body: new Uint8Array(4) }), mk(core))).status).toBe(200);
  expect(seen).toEqual([]);
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

const speakReq = (token: string | null = 'good') => req('speak', { method: 'POST', body: JSON.stringify({ noteId: 'n', text: 't', voice: 'v' }) }, token);
const cloneReq = (token: string | null = 'good', body: BodyInit = new Uint8Array(4), q = '?consent=1') => req(`voice/clone${q}`, { method: 'POST', body }, token);

it('speak, voice and clone/remove need a token', async () => {
  for (const r of [speakReq(null), req('voice', {}, null), cloneReq(null), req('voice/remove', { method: 'POST' }, null), speakReq('bad')]) {
    expect((await handleAsr(r, mk(ok))).status).toBe(401);
  }
});

it('speaks with the verified user and the parsed body', async () => {
  let seen: unknown[] = [];
  const speak = { speak: async (u: string, b: unknown) => ((seen = [u, b]), speaks.speak()) };
  const r = await handleAsr(speakReq(), mk(ok, [], { speak }));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ seconds: 3, used: 3, limit: 100, resetsAt: 'r' });
  expect(seen).toEqual(['u1', { noteId: 'n', text: 't', voice: 'v' }]);
});

it('speak with a body that is not JSON is a bad request', async () => {
  const r = await handleAsr(req('speak', { method: 'POST', body: 'nope' }), mk(ok));
  expect(r.status).toBe(400);
});

it('reports the voice state', async () => {
  expect(await (await handleAsr(req('voice'), mk(ok))).json()).toEqual(vstate);
});

it('clones from the body with consent, and removes', async () => {
  let seen: unknown[] = [];
  const voice = { ...voices, clone: async (u: string, b: Uint8Array, c: boolean) => ((seen = [u, b.length, c]), vstate) };
  expect((await handleAsr(cloneReq('good', new Uint8Array(4)), mk(ok, [], { voice }))).status).toBe(200);
  expect(seen).toEqual(['u1', 4, true]);
  await handleAsr(cloneReq('good', new Uint8Array(4), ''), mk(ok, [], { voice }));
  expect(seen).toEqual(['u1', 4, false]);
  expect(await (await handleAsr(req('voice/remove', { method: 'POST' }), mk(ok))).json()).toEqual(vstate);
});

it('413 on a clone body over the cap, before and while reading', async () => {
  const hdr = req('voice/clone?consent=1', { method: 'POST', body: new Uint8Array(4), headers: { 'content-length': String(MAX_BYTES + 1) } });
  expect((await handleAsr(hdr, mk(ok))).status).toBe(413);
  const big = new Uint8Array(MAX_BYTES + 1);
  const r = req('voice/clone?consent=1', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }), duplex: 'half' } as RequestInit);
  expect((await handleAsr(r, mk(ok))).status).toBe(413);
});

it.each([
  [new QuotaExceeded('2026-11-01T00:00:00.000Z'), 429, { error: 'quota_exceeded', resetsAt: '2026-11-01T00:00:00.000Z' }],
  [new StorageFull('s'), 413, { error: 'storage_full' }],
  [new NotYourNote('s'), 404, { error: 'not_found' }],
  [new BadSpeak('s'), 400, { error: 'bad_request' }],
  [new CloneUnavailable('s'), 403, { error: 'clone_unavailable' }],
  [new ProviderFailed('s'), 502, { error: 'provider_failed' }],
  [new Error('secret'), 500, { error: 'Server error' }],
])('speak maps %s', async (err, status, body) => {
  const r = await handleAsr(speakReq(), mk(ok, [], { speak: { speak: async () => { throw err; } } }));
  expect(r.status).toBe(status);
  expect(await r.json()).toEqual(body);
});

it.each([
  [new NeedsPaidPlan('s'), 403, { error: 'needs_paid_plan' }],
  [new NoConsent('s'), 400, { error: 'bad_request' }],
  [new BadSamples('s'), 400, { error: 'bad_request' }],
  [new CloneUnavailableNow('s'), 409, { error: 'unavailable' }],
  [new ProviderFailed('s'), 502, { error: 'provider_failed' }],
])('clone maps %s', async (err, status, body) => {
  const voice = { ...voices, clone: async () => { throw err; } };
  const r = await handleAsr(cloneReq(), mk(ok, [], { voice }));
  expect(r.status).toBe(status);
  expect(await r.json()).toEqual(body);
});

it('500 misconfigured when speak or voice is not wired', async () => {
  expect((await handleAsr(speakReq(), mk(ok, ['X'], { speak: null }))).status).toBe(500);
  expect((await handleAsr(req('voice'), mk(ok, ['X'], { voice: null }))).status).toBe(500);
});

it('404 on unknown voice routes and wrong methods', async () => {
  expect((await handleAsr(req('voice/nope', { method: 'POST' }), mk(ok))).status).toBe(404);
  expect((await handleAsr(req('voice', { method: 'POST' }), mk(ok))).status).toBe(404);
  expect((await handleAsr(req('speak'), mk(ok))).status).toBe(404);
});

it('404 on an unknown route', async () => {
  expect((await handleAsr(req('nope', { method: 'POST' }), mk(ok))).status).toBe(404);
  expect((await handleAsr(req('transcribe', { method: 'GET' }), mk(ok))).status).toBe(404);
});
