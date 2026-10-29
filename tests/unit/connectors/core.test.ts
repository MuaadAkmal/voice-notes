import { expect, it } from 'vitest';
import { ConnectorsCore, NotConnected, Revoked } from '../../../src/shared/connectors/core';
import type { TokenCipher } from '../../../src/shared/connectors/crypto';
import { type GoogleOAuth, InvalidGrant } from '../../../src/shared/connectors/google-oauth';
import { MemoryConnectorStore } from '../../../src/shared/connectors/memory-store';
import { CALENDAR_SCOPE } from '../../../src/shared/connectors/protocol';

const USER = '11111111-1111-4111-8111-111111111111';
const REDIRECT = 'https://x.supabase.co/functions/v1/connectors/google/callback';
const NOW = 1_800_000_000_000;

const idToken = (claims: object) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

// Sealing is visible in the stored row but reversible, so tests can tell sealed from plain.
const cipher: TokenCipher = {
  encrypt: async (p) => `sealed:${p}`,
  decrypt: async (s) => s.replace(/^sealed:/, ''),
};

function setup(google: Partial<GoogleOAuth> = {}) {
  const store = new MemoryConnectorStore();
  const calls = { exchange: 0, refreshed: [] as string[], revoked: [] as string[] };
  const fake: GoogleOAuth = {
    exchange: async () => {
      calls.exchange++;
      return { refreshToken: 'r1', scope: `openid email ${CALENDAR_SCOPE}`, idToken: idToken({ email: 'cal@gmail.com' }) };
    },
    refresh: async (t) => {
      calls.refreshed.push(t);
      return { accessToken: 'at', expiresIn: 3599 };
    },
    revoke: async (t) => void calls.revoked.push(t),
    ...google,
  };
  let n = 0;
  const now = { t: NOW };
  const core = new ConnectorsCore({
    store,
    google: fake,
    cipher,
    clientId: 'cid',
    redirectUri: REDIRECT,
    now: () => now.t,
    randomState: () => `state${++n}`,
  });
  return { core, store, calls, now };
}

it("start returns Google's URL with the agreed params", async () => {
  const { core, store } = setup();
  const { url } = await core.start(USER, 'me@gmail.com');
  const u = new URL(url);
  expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(u.searchParams)).toEqual({
    client_id: 'cid',
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: `openid email ${CALENDAR_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: 'me@gmail.com',
    state: 'state1',
  });
  expect(await store.takeState('state1', NOW + 599_999)).toEqual({ userId: USER, provider: 'google-calendar', returnPort: null });
});

it('start without an email leaves out login_hint', async () => {
  const { core } = setup();
  expect(new URL((await core.start(USER, null)).url).searchParams.has('login_hint')).toBe(false);
});

it('a state lasts 10 minutes', async () => {
  const { core, store } = setup();
  await core.start(USER, null);
  expect(await store.takeState('state1', NOW + 600_000)).toBeNull();
});

it('start clears expired states', async () => {
  const { core, store, now } = setup();
  await core.start(USER, null);
  now.t += 600_001;
  await core.start(USER, null);
  now.t = NOW; // even read back as if it were still live, the old one is gone
  expect(await store.takeState('state1', NOW)).toBeNull();
});

it('callback connects', async () => {
  const { core, store } = setup();
  await core.start(USER, null);
  expect((await core.callback({ code: 'c', state: 'state1' })).result).toBe('connected');
  expect(await core.status(USER)).toEqual({ google: { email: 'cal@gmail.com', connectedAt: NOW } });
  expect((await store.get(USER, 'google-calendar'))?.refreshToken).toBe('sealed:r1');
});

it('a state works once', async () => {
  const { core, calls } = setup();
  await core.start(USER, null);
  await core.callback({ code: 'c', state: 'state1' });
  expect((await core.callback({ code: 'c', state: 'state1' })).result).toBe('expired');
  expect(calls.exchange).toBe(1);
});

it('a missing or expired state is expired, and Google is never asked', async () => {
  const { core, calls, now } = setup();
  expect((await core.callback({ code: 'c' })).result).toBe('expired');
  expect((await core.callback({ code: 'c', state: 'nope' })).result).toBe('expired');
  await core.start(USER, null);
  now.t += 600_000;
  expect((await core.callback({ code: 'c', state: 'state1' })).result).toBe('expired');
  expect(calls.exchange).toBe(0);
});

it('error=access_denied is denied, and the state is used up', async () => {
  const { core, calls } = setup();
  await core.start(USER, null);
  expect((await core.callback({ error: 'access_denied', state: 'state1' })).result).toBe('denied');
  expect((await core.callback({ code: 'c', state: 'state1' })).result).toBe('expired');
  expect(calls.exchange).toBe(0);
});

it('refuses a grant without calendar.events', async () => {
  const { core } = setup({
    exchange: async () => ({ refreshToken: 'r1', scope: 'openid email', idToken: idToken({ email: 'cal@gmail.com' }) }),
  });
  await core.start(USER, null);
  expect((await core.callback({ code: 'c', state: 'state1' })).result).toBe('no-calendar');
  expect(await core.status(USER)).toEqual({ google: null });
});

it('no refresh token, or an exchange that throws, is failed', async () => {
  const none = setup({ exchange: async () => ({ refreshToken: null, scope: CALENDAR_SCOPE, idToken: null }) });
  await none.core.start(USER, null);
  expect((await none.core.callback({ code: 'c', state: 'state1' })).result).toBe('failed');
  expect(await none.core.status(USER)).toEqual({ google: null });

  const thrown = setup({ exchange: async () => Promise.reject(new Error('boom')) });
  await thrown.core.start(USER, null);
  expect((await thrown.core.callback({ code: 'c', state: 'state1' })).result).toBe('failed');
});

it('attempt tells the owner how the consent ended', async () => {
  const { core } = setup({
    exchange: async () => ({ refreshToken: 'r1', scope: 'openid email', idToken: null }),
  });
  await core.start(USER, null);
  expect(await core.attempt(USER, 'state1')).toEqual({ result: null });
  await core.callback({ code: 'c', state: 'state1' });
  expect(await core.attempt(USER, 'state1')).toEqual({ result: 'no-calendar' });
  expect(await core.attempt('22222222-2222-4222-8222-222222222222', 'state1')).toEqual({ result: null });
});

it('token refreshes with the decrypted token', async () => {
  const { core, calls } = setup();
  await core.start(USER, null);
  await core.callback({ code: 'c', state: 'state1' });
  expect(await core.token(USER)).toEqual({ accessToken: 'at', expiresIn: 3599 });
  expect(calls.refreshed).toEqual(['r1']);
});

it('token with no row throws NotConnected', async () => {
  const { core } = setup();
  await expect(core.token(USER)).rejects.toBeInstanceOf(NotConnected);
});

it('invalid_grant deletes the row', async () => {
  const { core } = setup({ refresh: async () => Promise.reject(new InvalidGrant('invalid_grant')) });
  await core.start(USER, null);
  await core.callback({ code: 'c', state: 'state1' });
  await expect(core.token(USER)).rejects.toBeInstanceOf(Revoked);
  expect(await core.status(USER)).toEqual({ google: null });
});

it('disconnect revokes and deletes', async () => {
  const { core, calls } = setup();
  await core.start(USER, null);
  await core.callback({ code: 'c', state: 'state1' });
  await core.disconnect(USER);
  expect(calls.revoked).toEqual(['r1']);
  expect(await core.status(USER)).toEqual({ google: null });
});

it('disconnect still deletes when revoking fails, and twice is fine', async () => {
  const { core } = setup({ revoke: async () => Promise.reject(new Error('offline')) });
  await core.start(USER, null);
  await core.callback({ code: 'c', state: 'state1' });
  await core.disconnect(USER);
  expect(await core.status(USER)).toEqual({ google: null });
  await core.disconnect(USER);
});

it('start stores a valid return port and ignores a bad one', async () => {
  for (const [port, kept] of [[51234, 51234], [1024, 1024], [65535, 65535], [80, null], [70000, null], [1.5, null], [NaN, null]] as const) {
    const { core } = setup();
    await core.start(USER, null, port);
    expect(await core.callback({ code: 'c', state: 'state1' }), String(port)).toEqual({ result: 'connected', returnPort: kept });
  }
});

it('an expired state has no port', async () => {
  const { core } = setup();
  expect(await core.callback({ code: 'c', state: 'nope' })).toEqual({ result: 'expired', returnPort: null });
});

it('a refused consent still carries the port', async () => {
  const { core } = setup();
  await core.start(USER, null, 51234);
  expect(await core.callback({ error: 'access_denied', state: 'state1' })).toEqual({ result: 'denied', returnPort: 51234 });
});
