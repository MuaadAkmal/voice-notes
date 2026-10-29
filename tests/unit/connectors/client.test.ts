import { expect, it } from 'vitest';
import { ConnectorsClient, NotConnected, Revoked } from '../../../src/main/connectors/client';
import { AuthExpired, NotSignedIn, Offline } from '../../../src/main/sync/http-server';

type Seen = { url: string; method: string; headers: Record<string, string> };

function client(respond: () => Response | Promise<Response>, token: string | null = 'tok') {
  const seen: Seen[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
    return respond();
  }) as typeof globalThis.fetch;
  return { c: new ConnectorsClient({ baseUrl: 'https://p.supabase.co', apiKey: 'pk', getToken: async () => token, fetch }), seen };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

it('calls the function routes with the key and the token', async () => {
  const { c, seen } = client(() => json(200, { google: null }));
  expect(await c.status()).toEqual({ google: null });
  expect(seen[0]).toMatchObject({
    url: 'https://p.supabase.co/functions/v1/connectors/status',
    method: 'GET',
    headers: { apikey: 'pk', authorization: 'Bearer tok' },
  });
  await c.start().catch(() => undefined);
  expect([seen[1].url, seen[1].method]).toEqual(['https://p.supabase.co/functions/v1/connectors/google/start', 'POST']);
});

it('no token is NotSignedIn, without a request', async () => {
  const { c, seen } = client(() => json(200, {}), null);
  await expect(c.status()).rejects.toBeInstanceOf(NotSignedIn);
  expect(seen).toHaveLength(0);
});

it('a network failure is Offline', async () => {
  const { c } = client(() => Promise.reject(new TypeError('fetch failed')));
  await expect(c.token()).rejects.toBeInstanceOf(Offline);
});

it('401 is AuthExpired', async () => {
  const { c } = client(() => json(401, { error: 'Sign in again' }));
  await expect(c.status()).rejects.toBeInstanceOf(AuthExpired);
});

it('404 not-connected is NotConnected, 409 is Revoked', async () => {
  await expect(client(() => json(404, { error: 'not-connected' })).c.token()).rejects.toBeInstanceOf(NotConnected);
  await expect(client(() => json(409, { error: 'revoked' })).c.token()).rejects.toBeInstanceOf(Revoked);
});

it('anything else is a server problem', async () => {
  const err = await client(() => json(500, { error: 'misconfigured' })).c.status().catch((e) => e);
  expect(err.message).toBe('The connectors server had a problem');
});

it('disconnect accepts 204', async () => {
  const { c, seen } = client(() => new Response(null, { status: 204 }));
  await c.disconnect();
  expect([seen[0].url, seen[0].method]).toEqual(['https://p.supabase.co/functions/v1/connectors/google/disconnect', 'POST']);
});
