import type { RemindRequest, RemindResponse, ResolveRequest, ResolveResponse } from '../../shared/commands/protocol';
import { AuthExpired, NotSignedIn, Offline } from '../sync/http-server';

// The app's side of the `commands` Edge Function (voice to lists). Only main calls it, with the
// app's own sign-in token; the Groq key never leaves the function.

/** The account sent its commands for today. */
export class LimitReached extends Error {
  constructor() {
    super('Daily limit reached');
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

export class CommandsClient {
  constructor(private readonly d: Deps) {}

  resolve(req: ResolveRequest): Promise<ResolveResponse> {
    return this.post('resolve', req);
  }

  /** When a reminder is due, for a time the app couldn't read itself. */
  remind(req: RemindRequest): Promise<RemindResponse> {
    return this.post('remind', req);
  }

  private async post<T>(route: 'resolve' | 'remind', req: unknown): Promise<T> {
    const token = await this.d.getToken();
    if (!token) throw new NotSignedIn();
    let res: Response;
    try {
      res = await this.d.fetch(`${this.d.baseUrl}/functions/v1/commands/${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, apikey: this.d.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(this.d.timeoutMs ?? 20_000),
      });
    } catch {
      throw new Offline();
    }
    if (res.status === 401) throw new AuthExpired();
    if (res.status === 429) throw new LimitReached();
    if (!res.ok) throw new Error('The lists server had a problem');
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error('The lists server had a problem'); // a captive portal or proxy page
    }
  }
}
