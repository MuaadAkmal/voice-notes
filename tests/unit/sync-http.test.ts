import { expect, it, vi } from 'vitest';
import { AuthExpired, HttpSyncServer, NotSignedIn, Offline, Rejected, ServerError } from '../../src/main/sync/http-server';

const pullBody = { cursor: 3, hasMore: false, rows: [], prefs: [] };

function make(respond: (url: string, init: RequestInit) => Promise<Response> | Response, token: string | null = 'tok') {
  const calls: { url: string; init: RequestInit }[] = [];
  const getToken = vi.fn(async () => token);
  const server = new HttpSyncServer({
    baseUrl: 'https://p.supabase.co',
    apiKey: 'sb_publishable_x',
    getToken,
    timeoutMs: 50,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch,
  });
  return { server, calls, getToken };
}

it('posts to the function with the token and key, and parses the answer', async () => {
  const { server, calls, getToken } = make(() => new Response(JSON.stringify(pullBody), { status: 200 }));
  await expect(server.pull({ clientId: 'c', cursor: 0 })).resolves.toEqual(pullBody);
  await server.push({ clientId: 'c', deviceName: 'PC', mutations: [] });
  expect(calls.map((c) => c.url)).toEqual(['https://p.supabase.co/functions/v1/sync/pull', 'https://p.supabase.co/functions/v1/sync/push']);
  const headers = calls[0].init.headers as Record<string, string>;
  expect(headers.authorization).toBe('Bearer tok');
  expect(headers.apikey).toBe('sb_publishable_x');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ clientId: 'c', cursor: 0 });
  expect(getToken).toHaveBeenCalledTimes(2); // fresh (possibly refreshed) token every call
});

it('without a session nothing is sent', async () => {
  const { server, calls } = make(() => new Response('{}'), null);
  await expect(server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(NotSignedIn);
  expect(calls).toEqual([]);
});

it('maps failures to what the controller acts on', async () => {
  await expect(make(() => Promise.reject(new TypeError('fetch failed'))).server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(Offline);
  await expect(make(() => new Response('{"error":"Sign in again"}', { status: 401 })).server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(AuthExpired);
  const rejected = make(() => new Response('{"error":"Invalid change"}', { status: 400 })).server.pull({ clientId: 'c', cursor: 0 });
  await expect(rejected).rejects.toBeInstanceOf(Rejected);
  await expect(rejected).rejects.toThrow('Invalid change');
  await expect(make(() => new Response('{"error":"Server error"}', { status: 503 })).server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(ServerError);
  await expect(make(() => new Response('<html>', { status: 200 })).server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(ServerError);
});

it('a call that hangs times out as offline', async () => {
  const { server } = make((_url, init) =>
    new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))),
  );
  await expect(server.pull({ clientId: 'c', cursor: 0 })).rejects.toBeInstanceOf(Offline);
});
