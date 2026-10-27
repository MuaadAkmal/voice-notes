import type {
  DownloadRequest,
  DownloadResponse,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  SyncServer,
  UploadRequest,
  UploadResponse,
} from '../../shared/sync/protocol';

// The app's side of the `sync` Edge Function. Failures come back as typed errors the controller acts
// on: wait and retry (Offline, ServerError), refresh the session (AuthExpired), or stop (Rejected).

export class NotSignedIn extends Error {
  constructor() {
    super('Not signed in');
  }
}
export class Offline extends Error {
  constructor() {
    super("Can't reach the server");
  }
}
export class AuthExpired extends Error {
  constructor() {
    super('Sign in again to keep syncing');
  }
}
export class Rejected extends Error {}
export class ServerError extends Error {
  constructor() {
    super('The sync server had a problem');
  }
}

type Deps = {
  baseUrl: string; // the Supabase project URL
  apiKey: string; // publishable key
  /** The current access token (supabase-js refreshes it as needed); null when signed out. */
  getToken(): Promise<string | null>;
  fetch: typeof fetch;
  timeoutMs?: number;
  /** For the file bytes themselves (long recordings on a slow line). */
  transferTimeoutMs?: number;
};

type Route = 'push' | 'pull' | 'files/upload' | 'files/download';
/** Storage refusing a file for size or quota: keep it on this PC and try again later. */
const STORAGE_FULL = /quota|exceeded|too large|maximum allowed size/i;

export class HttpSyncServer implements SyncServer {
  constructor(private readonly d: Deps) {}

  push(req: PushRequest): Promise<PushResponse> {
    return this.call<PushResponse>('push', req);
  }

  pull(req: PullRequest): Promise<PullResponse> {
    return this.call<PullResponse>('pull', req);
  }

  uploadUrl(req: UploadRequest): Promise<UploadResponse> {
    return this.call<UploadResponse>('files/upload', req);
  }

  downloadUrl(req: DownloadRequest): Promise<DownloadResponse> {
    return this.call<DownloadResponse>('files/download', req);
  }

  /** Uploads to a signed URL (no auth header: the URL carries its own short-lived token). */
  async put(url: string, bytes: Uint8Array, contentType: string): Promise<'ok' | 'storage-full'> {
    const res = await this.transfer(url, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes as Uint8Array<ArrayBuffer> });
    if (res.ok) return 'ok';
    const text = await res.text().catch(() => '');
    if (res.status === 413 || (res.status >= 400 && res.status < 500 && STORAGE_FULL.test(text))) return 'storage-full';
    if (res.status >= 400 && res.status < 500) throw new Rejected(`Upload refused (${res.status})`);
    throw new ServerError();
  }

  /** Downloads from a signed URL. */
  async get(url: string): Promise<Uint8Array> {
    const res = await this.transfer(url, { method: 'GET' });
    if (!res.ok) throw new ServerError();
    try {
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      throw new Offline(); // the connection dropped mid-file
    }
  }

  private async transfer(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.d.fetch(url, { ...init, signal: AbortSignal.timeout(this.d.transferTimeoutMs ?? 600_000) });
    } catch {
      throw new Offline();
    }
  }

  private async call<T>(route: Route, body: unknown): Promise<T> {
    const token = await this.d.getToken();
    if (!token) throw new NotSignedIn();
    let res: Response;
    try {
      res = await this.d.fetch(`${this.d.baseUrl}/functions/v1/sync/${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, apikey: this.d.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.d.timeoutMs ?? 30_000),
      });
    } catch {
      throw new Offline(); // no connection, DNS, proxy, or the timeout
    }
    if (res.status === 401) throw new AuthExpired();
    if (res.status === 400 || res.status === 413) throw new Rejected(await errorText(res));
    if (!res.ok) throw new ServerError();
    try {
      return (await res.json()) as T;
    } catch {
      throw new ServerError(); // a captive portal or proxy page, not our function
    }
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : 'Rejected by the server';
  } catch {
    return 'Rejected by the server';
  }
}
