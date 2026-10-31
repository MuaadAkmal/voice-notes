import { beforeEach, expect, it, vi } from 'vitest';
import { AccountService, type AuthLike, displayName } from '../../src/main/account/account';
import type { AccountInfo } from '../../src/shared/channels';

const user = {
  id: 'u1',
  email: 'muaad@example.com',
  user_metadata: { full_name: 'Muaad Akmal', avatar_url: 'https://lh3.googleusercontent.com/a/x' },
};
const session = { access_token: 'AT-secret', refresh_token: 'RT-secret', user };

let changes: AccountInfo[];
let authCb: ((event: string, s: typeof session | null) => void) | null;
let auth: Record<keyof AuthLike, ReturnType<typeof vi.fn>>;
let opened: string[];
let focused: number;
let cleared: number;
let redirect: { resolve: (c: { code: string }) => void; reject: (e: Error) => void; signal?: AbortSignal };
let redirectCalls: number;

function make(over: Partial<ConstructorParameters<typeof AccountService>[0]> = {}) {
  return new AccountService({
    auth: auth as unknown as AuthLike,
    store: { clear: () => void cleared++ },
    openExternal: async (url) => void opened.push(url),
    fetchImage: async () => 'data:image/png;base64,AAA',
    focusApp: () => void focused++,
    onChange: (info) => changes.push(info),
    redirect: async (opts) => {
      redirectCalls++;
      const result = new Promise<{ code: string }>((resolve, reject) => {
        redirect = { resolve, reject, signal: opts?.signal };
        opts?.signal?.addEventListener('abort', () => reject(new Error('Cancelled')));
      });
      return { url: 'http://127.0.0.1:5555/callback', result };
    },
    ...over,
  });
}

beforeEach(() => {
  changes = [];
  opened = [];
  focused = 0;
  cleared = 0;
  redirectCalls = 0;
  authCb = null;
  auth = {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://supabase/authorize?x' }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn((cb) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }),
  };
});

const signedIn: AccountInfo = {
  state: 'signed-in',
  userId: 'u1',
  email: 'muaad@example.com',
  name: 'Muaad Akmal',
  avatar: 'data:image/png;base64,AAA',
};

it('starts signed in when a session is stored, signed out otherwise', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });
  const a = make();
  await a.init();
  expect(a.current()).toEqual(signedIn);
  const b = make();
  await b.init();
  expect(b.current()).toEqual({ state: 'signed-out' });
});

it('signs in through the browser and the loopback', async () => {
  const a = make();
  await a.init();
  const running = a.signIn();
  await vi.waitFor(() => expect(opened).toEqual(['https://supabase/authorize?x']));
  expect(auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: 'http://127.0.0.1:5555/callback', skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  expect(a.current()).toEqual({ state: 'signing-in' });
  redirect.resolve({ code: 'the-code' });
  await running;
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('the-code');
  expect(a.current()).toEqual(signedIn);
  expect(focused).toBe(1);
});

it('a second click joins the sign-in already running', async () => {
  const a = make();
  const one = a.signIn();
  const two = a.signIn();
  await vi.waitFor(() => expect(opened).toHaveLength(1));
  redirect.resolve({ code: 'c' });
  await Promise.all([one, two]);
  expect(redirectCalls).toBe(1);
  expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
});

it('cancel ends signed out without an error', async () => {
  const a = make();
  const running = a.signIn();
  await vi.waitFor(() => expect(opened).toHaveLength(1));
  a.cancel();
  await running;
  expect(a.current()).toEqual({ state: 'signed-out' });
});

it('a refusal or an outage is reported', async () => {
  const a = make();
  const running = a.signIn();
  await vi.waitFor(() => expect(opened).toHaveLength(1));
  redirect.reject(new Error('Sign-in cancelled'));
  await running;
  expect(a.current()).toEqual({ state: 'signed-out', error: 'Sign-in cancelled' });

  auth.signInWithOAuth.mockRejectedValueOnce(new TypeError('fetch failed'));
  await a.signIn();
  expect(a.current()).toEqual({ state: 'signed-out', error: "Can't reach the server" });

  auth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
  await a.signIn();
  expect(a.current()).toEqual({ state: 'signed-out', error: "Can't reach the server" });
});

it('signing out ends the local session and forgets it', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });
  const a = make();
  await a.init();
  await a.signOut();
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(cleared).toBe(1);
  expect(a.current()).toEqual({ state: 'signed-out' });
});

it('no photo means initials', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });
  const a = make({ fetchImage: async () => null });
  await a.init();
  expect(a.current()).toMatchObject({ state: 'signed-in', avatar: null });
});

it('a session ended elsewhere (refresh token revoked) signs this PC out', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session }, error: null });
  const a = make();
  await a.init();
  authCb!('SIGNED_OUT', null);
  await vi.waitFor(() => expect(a.current()).toEqual({ state: 'signed-out' }));
});

it('started offline with an expired token: shows signed in once the refresh succeeds', async () => {
  auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
  const a = make();
  await a.init();
  expect(a.current()).toEqual({ state: 'signed-out' });
  authCb!('TOKEN_REFRESHED', session);
  await vi.waitFor(() => expect(a.current()).toEqual(signedIn));
});

it('the listener is stopped when the browser cannot be opened', async () => {
  const a = make({ openExternal: async () => Promise.reject(new Error('No browser')) });
  await a.signIn();
  expect(redirect.signal?.aborted).toBe(true);
  expect(a.current()).toEqual({ state: 'signed-out', error: 'No browser' });
});

it('never hands tokens or the code to the window', async () => {
  const a = make();
  const running = a.signIn();
  await vi.waitFor(() => expect(opened).toHaveLength(1));
  redirect.resolve({ code: 'the-code' });
  await running;
  const sent = JSON.stringify(changes);
  for (const secret of ['AT-secret', 'RT-secret', 'the-code']) expect(sent).not.toContain(secret);
});

it('names come from Google, else from the email', () => {
  expect(displayName({ id: 'x', email: 'a.b@c.d', user_metadata: { full_name: 'Full' } })).toBe('Full');
  expect(displayName({ id: 'x', email: 'a.b@c.d', user_metadata: { name: 'Name' } })).toBe('Name');
  expect(displayName({ id: 'x', email: 'a.b@c.d', user_metadata: {} })).toBe('a.b');
});
