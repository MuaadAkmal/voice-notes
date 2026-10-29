import type { CallbackResult, ConnectorsStatus, TokenResponse } from '../../shared/connectors/protocol';
import { AuthExpired, NotSignedIn, Offline } from '../sync/http-server';

// The app's side of the `connectors` Edge Function. The refresh token stays there; this only ever
// sees short-lived access tokens, and only main does.

/** Google no longer honours the connection: the user removed it at Google. */
export class Revoked extends Error {
  constructor() {
    super('Google access was removed');
  }
}
export class NotConnected extends Error {
  constructor() {
    super('Google Calendar is not connected');
  }
}

type Deps = {
  baseUrl: string; // the Supabase project URL
  apiKey: string; // publishable key
  /** The current access token of the app's own sign-in; null when signed out. */
  getToken(): Promise<string | null>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export class ConnectorsClient {
  constructor(private readonly d: Deps) {}

  start(): Promise<{ url: string }> {
    return this.call('POST', 'google/start');
  }

  status(): Promise<ConnectorsStatus> {
    return this.call('GET', 'status');
  }

  /** How the consent with this state ended; null while the browser is still at Google. */
  attempt(state: string): Promise<{ result: CallbackResult | null }> {
    return this.call('GET', `google/attempt?state=${encodeURIComponent(state)}`);
  }

  token(): Promise<TokenResponse> {
    return this.call('GET', 'google/token');
  }

  async disconnect(): Promise<void> {
    await this.call('POST', 'google/disconnect');
  }

  private async call<T>(method: 'GET' | 'POST', route: string): Promise<T> {
    const token = await this.d.getToken();
    if (!token) throw new NotSignedIn();
    let res: Response;
    try {
      res = await this.d.fetch(`${this.d.baseUrl}/functions/v1/connectors/${route}`, {
        method,
        headers: { authorization: `Bearer ${token}`, apikey: this.d.apiKey },
        signal: AbortSignal.timeout(this.d.timeoutMs ?? 30_000),
      });
    } catch {
      throw new Offline();
    }
    if (res.status === 401) throw new AuthExpired();
    if (res.status === 404 && (await errorCode(res)) === 'not-connected') throw new NotConnected();
    if (res.status === 409) throw new Revoked();
    if (!res.ok) throw new Error('The connectors server had a problem');
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error('The connectors server had a problem'); // a captive portal or proxy page
    }
  }
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}
