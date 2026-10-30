import type { TranscribeResponse, UsageResponse } from '../../shared/asr/protocol';
import { MAX_SECONDS } from '../../shared/asr/protocol';
import { transcriptionError } from '../../shared/transcription-errors';
import { trimWav } from '../../shared/wav';
import { NotSignedIn, Offline } from '../sync/http-server';

// The app's side of the `asr` Edge Function (cloud transcription), with the app's own sign-in
// token. Longer clips are trimmed to the function's limit rather than refused.

/** Signed out, or the token was refused even after a refresh. */
export class CloudNotSignedIn extends NotSignedIn {
  constructor() {
    super();
    this.message = transcriptionError({ kind: 'signed-out' });
  }
}
export class QuotaExceeded extends Error {
  constructor(readonly resetsAt: string) {
    super(transcriptionError({ kind: 'quota', resetsAt }));
  }
}
export class TooLarge extends Error {
  constructor() {
    super(transcriptionError({ kind: 'too-large' }));
  }
}
export class ProviderFailed extends Error {
  constructor() {
    super(transcriptionError({ kind: 'provider-failed' }));
  }
}

type Deps = {
  baseUrl: string; // …/functions/v1/asr
  apiKey: string; // publishable key
  token: () => Promise<string | null>;
  refresh: () => Promise<void>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export class CloudAsrClient {
  constructor(private readonly d: Deps) {}

  async transcribe(audio: Uint8Array, language: string | null, signal?: AbortSignal): Promise<{ text: string; language: string | null }> {
    const body = trimWav(audio, MAX_SECONDS);
    const query = language ? `?language=${encodeURIComponent(language)}` : '';
    const r = await this.call<TranscribeResponse>(`/transcribe${query}`, { method: 'POST', body, contentType: 'audio/wav', signal });
    return { text: typeof r.text === 'string' ? r.text : '', language: r.language ?? null };
  }

  usage(): Promise<UsageResponse> {
    return this.call<UsageResponse>('/usage', { method: 'GET' });
  }

  private async call<T>(path: string, o: { method: string; body?: Uint8Array; contentType?: string; signal?: AbortSignal }): Promise<T> {
    let res = await this.send(path, o);
    if (res.status === 401) {
      await this.d.refresh().catch(() => undefined);
      res = await this.send(path, o);
      if (res.status === 401) throw new CloudNotSignedIn();
    }
    if (res.status === 429) {
      const j = (await res.json().catch(() => ({}))) as { resetsAt?: unknown };
      throw new QuotaExceeded(typeof j.resetsAt === 'string' ? j.resetsAt : '');
    }
    if (res.status === 413) throw new TooLarge();
    if (!res.ok) throw new ProviderFailed();
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderFailed(); // a captive portal or proxy page
    }
  }

  private async send(path: string, o: { method: string; body?: Uint8Array; contentType?: string; signal?: AbortSignal }): Promise<Response> {
    const token = await this.d.token();
    if (!token) throw new CloudNotSignedIn();
    const timeout = AbortSignal.timeout(this.d.timeoutMs ?? 120_000);
    try {
      return await this.d.fetch(`${this.d.baseUrl}${path}`, {
        method: o.method,
        headers: { authorization: `Bearer ${token}`, apikey: this.d.apiKey, ...(o.contentType ? { 'content-type': o.contentType } : {}) },
        body: o.body as BodyInit | undefined,
        signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      });
    } catch (e) {
      if (o.signal?.aborted) throw e;
      throw new Offline();
    }
  }
}
