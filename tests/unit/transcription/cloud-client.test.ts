import { expect, it, vi } from 'vitest';
import {
  CloudAsrClient,
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
  expect(await client.transcribe(silentWav(1), null)).toEqual({ text: 'hi', language: 'en' });
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

it('reads usage', async () => {
  const u = { used: 3, limit: 60, resetsAt: RESULT.resetsAt, plan: 'free' };
  const { client, f } = make(async () => ok(u));
  expect(await client.usage()).toEqual(u);
  expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/functions/v1/asr/usage');
  expect((f.mock.calls[0][1]!.headers as Record<string, string>).apikey).toBe('pk');
});

it('says what to do in its messages', () => {
  expect(new QuotaExceeded(new Date(2026, 10, 1, 9).toISOString()).message).toBe('Free minutes used · resets 1 Nov');
});
