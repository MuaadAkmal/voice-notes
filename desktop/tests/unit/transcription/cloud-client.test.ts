import { expect, it, vi } from 'vitest';
import {
  CloneUnavailable,
  CloneUnavailableNow,
  CloudAsrClient,
  NeedsPaidPlan,
  NotSynced,
  StorageFull,
  ProviderFailed,
  QuotaExceeded,
  TooLarge,
} from '../../../src/main/transcription/cloud-client';
import { NotSignedIn, Offline } from '../../../src/main/sync/http-server';
import { silentWav } from '../../../src/shared/wav';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const RESULT = { text: 'hi', language: 'en', seconds: 1, used: 1, limit: 60, resetsAt: '2026-11-01T00:00:00.000Z' };

const make = (fetch: (url: string, init?: RequestInit) => Promise<Response>, token: string | null = 't') => {
  const refresh = vi.fn(async () => undefined);
  const f = vi.fn(fetch);
  const client = new CloudAsrClient({
    baseUrl: 'https://x.supabase.co/functions/v1/asr',
    apiKey: 'pk',
    token: async () => token,
    refresh,
    fetch: f as never,
  });
  return { client, refresh, f };
};

it('throws NotSignedIn without a token and never fetches', async () => {
  const { client, f } = make(async () => ok(RESULT), null);
  await expect(client.transcribe(silentWav(1), null)).rejects.toBeInstanceOf(NotSignedIn);
  expect(f).not.toHaveBeenCalled();
});

it('maps a rejected fetch to Offline', async () => {
  const { client } = make(async () => {
    throw new Error('net');
  });
  await expect(client.transcribe(silentWav(1), null)).rejects.toBeInstanceOf(Offline);
});

it('refreshes once on 401', async () => {
  let n = 0;
  const { client, refresh } = make(async () => (n++ === 0 ? ok({ error: 'x' }, 401) : ok(RESULT)));
  expect(await client.transcribe(silentWav(1), null)).toMatchObject({ text: 'hi', language: 'en' });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('gives NotSignedIn after 401 twice', async () => {
  const { client, refresh } = make(async () => ok({ error: 'x' }, 401));
  await expect(client.transcribe(silentWav(1), null)).rejects.toBeInstanceOf(NotSignedIn);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('maps 429 to QuotaExceeded with resetsAt', async () => {
  const { client } = make(async () => ok({ error: 'quota_exceeded', resetsAt: '2026-11-01T00:00:00.000Z' }, 429));
  const e = await client.transcribe(silentWav(1), null).catch((x) => x);
  expect(e).toBeInstanceOf(QuotaExceeded);
  expect(e.resetsAt).toBe('2026-11-01T00:00:00.000Z');
});

it('maps 502 to ProviderFailed and 413 to TooLarge', async () => {
  await expect(make(async () => ok({}, 502)).client.transcribe(silentWav(1), null)).rejects.toBeInstanceOf(ProviderFailed);
  await expect(make(async () => ok({}, 413)).client.transcribe(silentWav(1), null)).rejects.toBeInstanceOf(TooLarge);
});

it('sends only the first 300 s of a longer WAV', async () => {
  const { client, f } = make(async () => ok(RESULT));
  await client.transcribe(silentWav(301, 1000), null);
  const body = f.mock.calls[0][1]!.body as Uint8Array;
  expect(body.length).toBe(44 + 300 * 1000 * 2);
});

it('sends language as a query only when set, with the bearer token', async () => {
  const { client, f } = make(async () => ok(RESULT));
  await client.transcribe(silentWav(1), null);
  await client.transcribe(silentWav(1), 'fr');
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/transcribe');
  expect(f.mock.calls[1][0]).toBe('https://x.supabase.co/functions/v1/asr/transcribe?language=fr');
  expect((f.mock.calls[0][1]!.headers as Record<string, string>).authorization).toBe('Bearer t');
  expect((f.mock.calls[1][1]!.headers as Record<string, string>).apikey).toBe('pk');
});

it('sends key terms as a query only when there are some', async () => {
  const { client, f } = make(async () => ok(RESULT));
  await client.transcribe(silentWav(1), null, undefined, false, ['Muaad']);
  await client.transcribe(silentWav(1), null, undefined, false, []);
  expect(f.mock.calls[0][0]).toBe(`https://x.supabase.co/functions/v1/asr/transcribe?keyterms=${encodeURIComponent('["Muaad"]')}`);
  expect(f.mock.calls[1][0]).toBe('https://x.supabase.co/functions/v1/asr/transcribe');
});

it('returns the usage for the month when the function sends it', async () => {
  const { client } = make(async () => ok(RESULT));
  expect((await client.transcribe(silentWav(1), null)).usage).toEqual({ used: 1, limit: 60, resetsAt: RESULT.resetsAt });
});

it('returns no usage from a function that leaves it out', async () => {
  const { client } = make(async () => ok({ text: 'hi', language: 'en' }));
  expect((await client.transcribe(silentWav(1), null)).usage).toBeUndefined();
});

it('reads usage', async () => {
  const u = { used: 3, limit: 60, resetsAt: RESULT.resetsAt, plan: 'free' };
  const { client, f } = make(async () => ok(u));
  expect(await client.usage()).toEqual(u);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/usage');
  expect((f.mock.calls[0][1]!.headers as Record<string, string>).apikey).toBe('pk');
});

const VOICE = { stock: [], clone: 'none', canClone: false, plan: 'free' };
const SPOKEN = { seconds: 3, used: 10, limit: 60, resetsAt: '2026-11-01T00:00:00.000Z' };

it('speak posts JSON and returns the usage', async () => {
  const { client, f } = make(async () => ok(SPOKEN));
  expect(await client.speak({ noteId: 'n', text: 'hello', voice: 'v' })).toEqual(SPOKEN);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/speak');
  const init = f.mock.calls[0][1]!;
  expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  expect(JSON.parse(init.body as string)).toEqual({ noteId: 'n', text: 'hello', voice: 'v' });
});

it.each([
  [429, { error: 'quota_exceeded', resetsAt: 'r' }, QuotaExceeded],
  [413, { error: 'storage_full' }, StorageFull],
  [413, { error: 'too_large' }, TooLarge],
  [403, { error: 'clone_unavailable' }, CloneUnavailable],
  [502, { error: 'provider' }, ProviderFailed],
  [404, { error: 'not_found' }, NotSynced],
])('speak maps %s %j', async (status, body, Err) => {
  const { client } = make(async () => ok(body, status));
  await expect(client.speak({ noteId: 'n', text: 't', voice: 'v' })).rejects.toBeInstanceOf(Err);
});

it('voice reads the state', async () => {
  const { client, f } = make(async () => ok(VOICE));
  expect(await client.voice()).toEqual(VOICE);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/voice');
  expect(f.mock.calls[0][1]!.method).toBe('GET');
});

it('clone sends the WAV with consent', async () => {
  const { client, f } = make(async () => ok(VOICE));
  await client.clone(silentWav(1), true);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/voice/clone?consent=1');
  expect((f.mock.calls[0][1]!.headers as Record<string, string>)['content-type']).toBe('audio/wav');
});

it.each([
  [409, { error: 'unavailable' }, CloneUnavailableNow],
  [403, { error: 'needs_paid_plan' }, NeedsPaidPlan],
  [403, { error: 'clone_unavailable' }, CloneUnavailable],
  [502, {}, ProviderFailed],
])('clone maps %s %j', async (status, body, Err) => {
  const { client } = make(async () => ok(body, status));
  await expect(client.clone(silentWav(1), true)).rejects.toBeInstanceOf(Err);
});

it('clone leaves consent out unless it is true', async () => {
  const { client, f } = make(async () => ok(VOICE));
  await client.clone(silentWav(1), false);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/voice/clone');
});

it('removeClone posts to voice/remove', async () => {
  const { client, f } = make(async () => ok(VOICE));
  await client.removeClone();
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/voice/remove');
  expect(f.mock.calls[0][1]!.method).toBe('POST');
});

it('says what to do in its messages', () => {
  expect(new QuotaExceeded(new Date(2026, 10, 1, 9).toISOString()).message).toBe('Cloud minutes used · resets 1 Nov');
});

it.each([
  ['eng', null, 'en'],
  ['zho', null, 'zh'],
  ['fr', null, 'fr'],
  ['xyz', null, null],
  ['eng', 'fr', 'fr'],
])('stores a two-letter language: said %s, asked %s -> %s', async (said, asked, want) => {
  const { client } = make(async () => ok({ ...RESULT, language: said }));
  expect((await client.transcribe(silentWav(1), asked)).language).toBe(want);
});

it('speak waits 180 s, longer than the function takes', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  try {
    const { client } = make(async () => ok(SPOKEN));
    await client.speak({ noteId: 'n', text: 't', voice: 'v' });
    expect(timeout).toHaveBeenCalledWith(180_000);
  } finally {
    timeout.mockRestore();
  }
});

it('sample gets the MP3 with the bearer token', async () => {
  const { client, f } = make(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }));
  expect(await client.sample('v 1')).toEqual(new Uint8Array([1, 2, 3]));
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/voice/sample/v%201');
  const init = f.mock.calls[0][1]!;
  expect(init.method).toBe('GET');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
  expect((init.headers as Record<string, string>).apikey).toBe('pk');
});

it('sample refreshes the token once on 401', async () => {
  let n = 0;
  const { client, refresh } = make(async () => (n++ === 0 ? ok({}, 401) : new Response(new Uint8Array([7]))));
  expect(await client.sample('v')).toEqual(new Uint8Array([7]));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('sample: 401 twice is signed out, 502 is ProviderFailed, 400 too, a dead network is Offline', async () => {
  await expect(make(async () => ok({}, 401)).client.sample('v')).rejects.toBeInstanceOf(NotSignedIn);
  await expect(make(async () => ok({}, 502)).client.sample('v')).rejects.toBeInstanceOf(ProviderFailed);
  await expect(make(async () => ok({}, 400)).client.sample('v')).rejects.toBeInstanceOf(ProviderFailed);
  await expect(make(async () => { throw new Error('x'); }).client.sample('v')).rejects.toBeInstanceOf(Offline);
});
