import { expect, it } from 'vitest';
import { ConnectorsCore, NotConnected, Revoked } from '../../../src/shared/connectors/core';
import { type ConnectorsHandlerDeps, handleConnectors } from '../../../src/shared/connectors/handler';
import { MemoryConnectorStore } from '../../../src/shared/connectors/memory-store';

const USER = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://x.supabase.co/functions/v1/connectors';

function core(over: Partial<ConnectorsCore> = {}): ConnectorsHandlerDeps['core'] {
  const real = new ConnectorsCore({
    store: new MemoryConnectorStore(),
    google: {
      exchange: async () => ({ refreshToken: null, scope: '', idToken: null }),
      refresh: async () => ({ accessToken: 'at', expiresIn: 3600 }),
      revoke: async () => undefined,
    },
    cipher: { encrypt: async (s) => s, decrypt: async (s) => s },
    clientId: 'cid',
    redirectUri: `${BASE}/google/callback`,
    now: () => 1,
    randomState: () => 'st',
  });
  return Object.assign(real, over);
}

function setup(d: Partial<ConnectorsHandlerDeps> = {}) {
  const deps: ConnectorsHandlerDeps = {
    verify: async (jwt) => (jwt === 'good' ? { userId: USER, email: 'me@gmail.com' } : null),
    core: core(),
    missing: [],
    ...d,
  };
  return (method: string, route: string, token: string | null = 'good') =>
    handleConnectors(
      new Request(`${BASE}/${route}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} }),
      deps,
    );
}

it('misconfigured lists the missing names on every route, before any auth', async () => {
  const call = setup({ core: null, missing: ['GOOGLE_CLIENT_SECRET'] });
  const res = await call('GET', 'status', null);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'misconfigured', missing: ['GOOGLE_CLIENT_SECRET'] });
  expect((await call('GET', 'google/callback?code=c&state=s', null)).status).toBe(500);
});

it('401 without a token, or with one that does not verify', async () => {
  const call = setup();
  for (const [m, r] of [['POST', 'google/start'], ['GET', 'google/token'], ['POST', 'google/disconnect'], ['GET', 'status']]) {
    expect((await call(m, r, null)).status, r).toBe(401);
    expect((await call(m, r, 'bad')).status, r).toBe(401);
  }
});

it('callback needs no token and answers a page', async () => {
  const res = await setup()('GET', 'google/callback?code=c&state=unknown', null);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/text\/html/);
  expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
  expect(await res.text()).toContain('This link has expired. Start again from Voice Notes.');
});

it('the callback page never echoes the query', async () => {
  const res = await setup()('GET', 'google/callback?state=%3Cscript%3Ex%3C%2Fscript%3E&error=%3Cb%3E', null);
  const html = await res.text();
  expect(html).not.toContain('<script>x');
  expect(html).not.toContain('<b>');
});

it('start passes the token email and returns the URL', async () => {
  let seen: [string, string | null] | null = null;
  const call = setup({ core: core({ start: async (u, e) => ((seen = [u, e]), { url: 'https://accounts.google.com/x' }) }) });
  const res = await call('POST', 'google/start');
  expect(await res.json()).toEqual({ url: 'https://accounts.google.com/x' });
  expect(seen).toEqual([USER, 'me@gmail.com']);
});

it('token maps NotConnected to 404 and Revoked to 409', async () => {
  const nc = setup({ core: core({ token: async () => Promise.reject(new NotConnected()) }) });
  const r1 = await nc('GET', 'google/token');
  expect([r1.status, await r1.json()]).toEqual([404, { error: 'not-connected' }]);
  const rv = setup({ core: core({ token: async () => Promise.reject(new Revoked()) }) });
  const r2 = await rv('GET', 'google/token');
  expect([r2.status, await r2.json()]).toEqual([409, { error: 'revoked' }]);
});

it('token, disconnect and status answer as agreed', async () => {
  const call = setup({ core: core({ token: async () => ({ accessToken: 'at', expiresIn: 3599 }) }) });
  expect(await (await call('GET', 'google/token')).json()).toEqual({ accessToken: 'at', expiresIn: 3599 });
  expect((await call('POST', 'google/disconnect')).status).toBe(204);
  expect(await (await call('GET', 'status')).json()).toEqual({ google: null });
});

it('attempt needs a token and passes the state', async () => {
  let seen: [string, string] | null = null;
  const call = setup({ core: core({ attempt: async (u, s) => ((seen = [u, s]), { result: 'denied' as const }) }) });
  expect((await call('GET', 'google/attempt?state=st1', null)).status).toBe(401);
  expect(await (await call('GET', 'google/attempt?state=st1')).json()).toEqual({ result: 'denied' });
  expect(seen).toEqual([USER, 'st1']);
});

it('a thrown error is a bare 500', async () => {
  const call = setup({ core: core({ status: async () => Promise.reject(new Error('db password wrong')) }) });
  const res = await call('GET', 'status');
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain('password');
});

it('an unknown route or wrong method is 404', async () => {
  const call = setup();
  expect((await call('GET', 'nope')).status).toBe(404);
  expect((await call('GET', 'google/start')).status).toBe(404);
  expect((await call('POST', 'status')).status).toBe(404);
});
