import type { TokenCipher } from './crypto.ts';
import { emailFromIdToken, type GoogleOAuth, InvalidGrant } from './google-oauth.ts';
import { CALENDAR_SCOPE, type CallbackResult, type ConnectorsStatus, type TokenResponse } from './protocol.ts';
import type { ConnectorStore } from './store.ts';

// The rules of the `connectors` Edge Function: start a consent round trip, finish it from Google's
// redirect, hand out short-lived access tokens, disconnect. Free of Deno, so it is unit-tested in Node.

export class NotConnected extends Error {}
export class Revoked extends Error {}

export type { CallbackResult };

const PROVIDER = 'google-calendar';
const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = `openid email ${CALENDAR_SCOPE}`;

type Deps = {
  store: ConnectorStore;
  google: GoogleOAuth;
  cipher: TokenCipher;
  clientId: string;
  redirectUri: string;
  now(): number;
  randomState(): string;
};

export class ConnectorsCore {
  constructor(private readonly d: Deps) {}

  /** `returnPort`: where the app listens for the browser after consent; anything but a plain port is ignored. */
  async start(userId: string, email: string | null, returnPort?: number): Promise<{ url: string }> {
    const now = this.d.now();
    await this.d.store.deleteExpiredStates(now);
    const state = this.d.randomState();
    const port = isPort(returnPort) ? returnPort : null;
    await this.d.store.putState({ state, userId, provider: PROVIDER, expiresAt: now + STATE_TTL_MS, returnPort: port });
    const params = new URLSearchParams({
      client_id: this.d.clientId,
      redirect_uri: this.d.redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline', // a refresh token
      prompt: 'consent', // every time, or Google leaves the refresh token out on a reconnect
      include_granted_scopes: 'true',
      ...(email ? { login_hint: email } : {}),
      state,
    });
    return { url: `${AUTH_URL}?${params}` };
  }

  /** How the round trip ended, and the app's port to send the browser on to (null: none known). */
  async callback(q: { code?: string; state?: string; error?: string }): Promise<{ result: CallbackResult; returnPort: number | null }> {
    const owner = q.state ? await this.d.store.takeState(q.state, this.d.now()) : null;
    if (!owner || !q.state) return { result: 'expired', returnPort: null };
    const result = await this.finish(owner.userId, q);
    await this.d.store.finishState(q.state, result);
    return { result, returnPort: owner.returnPort };
  }

  /** How `userId`'s round trip with `state` ended; null while the browser is still at Google. */
  async attempt(userId: string, state: string): Promise<{ result: CallbackResult | null }> {
    return { result: await this.d.store.stateResult(userId, state) };
  }

  private async finish(userId: string, q: { code?: string; error?: string }): Promise<CallbackResult> {
    if (q.error || !q.code) return 'denied';
    try {
      const grant = await this.d.google.exchange(q.code, this.d.redirectUri);
      // Google's consent lets the user untick the calendar box and still say yes.
      if (!grant.scope.split(' ').includes(CALENDAR_SCOPE)) return 'no-calendar';
      if (!grant.refreshToken) return 'failed';
      await this.d.store.put({
        userId,
        provider: PROVIDER,
        accountEmail: (grant.idToken && emailFromIdToken(grant.idToken)) || '',
        refreshToken: await this.d.cipher.encrypt(grant.refreshToken),
        scopes: grant.scope,
        connectedAt: this.d.now(),
      });
      return 'connected';
    } catch (err) {
      console.error('[connectors] callback', err instanceof Error ? err.message : err);
      return 'failed';
    }
  }

  async token(userId: string): Promise<TokenResponse> {
    const row = await this.d.store.get(userId, PROVIDER);
    if (!row) throw new NotConnected();
    try {
      return await this.d.google.refresh(await this.d.cipher.decrypt(row.refreshToken));
    } catch (err) {
      if (!(err instanceof InvalidGrant)) throw err;
      await this.d.store.delete(userId, PROVIDER);
      throw new Revoked();
    }
  }

  async disconnect(userId: string): Promise<void> {
    const row = await this.d.store.get(userId, PROVIDER);
    if (!row) return;
    // Best effort: the row goes either way, so the app never shows a connection the user removed.
    await this.d.google
      .revoke(await this.d.cipher.decrypt(row.refreshToken))
      .catch((err) => console.error('[connectors] revoke', err instanceof Error ? err.message : err));
    await this.d.store.delete(userId, PROVIDER);
  }

  async status(userId: string): Promise<ConnectorsStatus> {
    const row = await this.d.store.get(userId, PROVIDER);
    return { google: row ? { email: row.accountEmail, connectedAt: row.connectedAt } : null };
  }
}

const isPort = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 1024 && (p as number) <= 65535;
