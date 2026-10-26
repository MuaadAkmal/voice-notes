import type { AccountInfo } from '../../shared/channels';
import { waitForRedirect } from './loopback';

type UserLike = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type SessionLike = { user: UserLike };
type AuthError = { name?: string; message: string } | null;

/** The part of supabase-js's `client.auth` this service uses (a fake in tests). */
export type AuthLike = {
  getSession(): Promise<{ data: { session: SessionLike | null }; error: AuthError }>;
  signInWithOAuth(c: {
    provider: 'google';
    options: { redirectTo: string; skipBrowserRedirect: boolean; queryParams: Record<string, string> };
  }): Promise<{ data: { url: string | null }; error: AuthError }>;
  exchangeCodeForSession(code: string): Promise<{ data: { session: SessionLike | null }; error: AuthError }>;
  signOut(o: { scope: 'local' }): Promise<{ error: AuthError }>;
  onAuthStateChange(cb: (event: string, session: SessionLike | null) => void): unknown;
};

type Deps = {
  auth: AuthLike;
  store: { clear(): void };
  openExternal(url: string): Promise<void>;
  /** The Google photo as a data: URL, or null (the chip shows initials). */
  fetchImage(url: string): Promise<string | null>;
  focusApp(): void;
  onChange(info: AccountInfo): void;
  redirect?: typeof waitForRedirect;
};

const OFFLINE = "Can't reach the server";

/** Google sign-in through Supabase (PKCE), run in main: the browser signs in, the loopback brings the code back. */
export class AccountService {
  private info: AccountInfo = { state: 'signed-out' };
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private readonly redirect: typeof waitForRedirect;

  constructor(private readonly d: Deps) {
    this.redirect = d.redirect ?? waitForRedirect;
  }

  current(): AccountInfo {
    return this.info;
  }

  async init(): Promise<void> {
    this.d.auth.onAuthStateChange((event, session) => {
      // A refresh token revoked elsewhere (or signed out in another way) ends this PC's session too.
      if (event === 'SIGNED_OUT' && this.info.state === 'signed-in') this.set({ state: 'signed-out' });
      else if (event === 'USER_UPDATED' && session) void this.signedIn(session.user);
    });
    const { data } = await this.d.auth.getSession();
    if (data.session) await this.signedIn(data.session.user);
    else this.set({ state: 'signed-out' });
  }

  /** A second call while one runs joins it (one browser tab, one listener). */
  signIn(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
      this.abort = null;
    });
    return this.running;
  }

  cancel(): void {
    this.abort?.abort();
  }

  async signOut(): Promise<void> {
    try {
      await this.d.auth.signOut({ scope: 'local' });
    } finally {
      this.d.store.clear(); // signed out on this PC even if the server couldn't be told
      this.set({ state: 'signed-out' });
    }
  }

  /** e2e: pretend to be signed in (or out) without Google. */
  setTestSession(info: AccountInfo | null): void {
    this.set(info ?? { state: 'signed-out' });
  }

  private async run(): Promise<void> {
    this.abort = new AbortController();
    this.set({ state: 'signing-in' });
    try {
      const { url, result } = await this.redirect({ signal: this.abort.signal });
      const { data, error } = await this.d.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: url, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      });
      if (error || !data.url) {
        this.abort.abort(); // stop the listener
        result.catch(() => undefined);
        throw error ?? new Error('Sign-in failed');
      }
      await this.d.openExternal(data.url);
      const { code } = await result;
      const exchanged = await this.d.auth.exchangeCodeForSession(code);
      if (exchanged.error || !exchanged.data.session) throw exchanged.error ?? new Error('Sign-in failed');
      await this.signedIn(exchanged.data.session.user);
      this.d.focusApp();
    } catch (err) {
      const message = errorMessage(err);
      this.set(message === 'Cancelled' ? { state: 'signed-out' } : { state: 'signed-out', error: message });
    }
  }

  private async signedIn(user: UserLike): Promise<void> {
    const avatarUrl = typeof user.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : null;
    const avatar = avatarUrl ? await this.d.fetchImage(avatarUrl).catch(() => null) : null;
    this.set({ state: 'signed-in', userId: user.id, email: user.email ?? '', name: displayName(user), avatar });
  }

  private set(info: AccountInfo): void {
    this.info = info;
    this.d.onChange(info);
  }
}

/** Google's full name, else its name, else the part of the email before the @. */
export function displayName(user: UserLike): string {
  const meta = user.user_metadata ?? {};
  for (const k of ['full_name', 'name']) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return (user.email ?? '').split('@')[0];
}

function errorMessage(err: unknown): string {
  if (err instanceof TypeError) return OFFLINE; // fetch couldn't connect
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AuthRetryableFetchError') return OFFLINE;
  return e?.message || 'Sign-in failed';
}
