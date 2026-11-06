import type { SpeakRequest, SpeakResponse, TranscribeResponse, UsageResponse, VoiceState } from '../../shared/asr/protocol';
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
/** The account's Cloud storage has no room for the polished file. */
export class StorageFull extends Error {
  constructor() {
    super('Storage full');
  }
}
/** The note is not on the server yet (it syncs first). */
export class NotSynced extends Error {
  constructor() {
    super('Note not synced');
  }
}
/** The server has cloning switched off, or the account's copies are all used. */
export class CloneUnavailable extends Error {
  constructor() {
    super('Not available right now');
  }
}
/** A clone can't be made at this moment (the provider is busy); try later. */
export class CloneUnavailableNow extends Error {
  constructor() {
    super('Not available right now');
  }
}
export class NeedsPaidPlan extends Error {
  constructor() {
    super('Cloning your voice needs a paid plan');
  }
}

// ElevenLabs says ISO 639-3 ("eng"); notes store the 2-letter code the other providers use.
const THREE: Record<string, string> = {
  eng: 'en', spa: 'es', hin: 'hi', ara: 'ar', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ita: 'it', por: 'pt',
  rus: 'ru', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', tur: 'tr', urd: 'ur', nld: 'nl', dut: 'nl',
};
function twoLetter(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const s = code.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(s)) return s;
  return THREE[s] ?? null;
}

export type CloudUsage = { used: number; limit: number; resetsAt: string };

/** The usage in a transcribe reply, when all of it is there. */
function usageOf(r: Partial<TranscribeResponse>): CloudUsage | undefined {
  const { used, limit, resetsAt } = r;
  return typeof used === 'number' && typeof limit === 'number' && typeof resetsAt === 'string' ? { used, limit, resetsAt } : undefined;
}

type Deps = {
  baseUrl: string; // …/functions/v1/asr
  apiKey: string; // publishable key
  token: () => Promise<string | null>;
  refresh: () => Promise<void>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

type CallOptions = {
  method: string;
  body?: Uint8Array | string;
  contentType?: string;
  signal?: AbortSignal;
  /** The error for a refused request, by status and the reply's `error` code; undefined: the default. */
  /** Overrides the client's timeout. */
  timeoutMs?: number;
  mapError?: (status: number, code: string) => Error | undefined;
};

function speakError(status: number, code: string): Error | undefined {
  if (status === 413) return code === 'storage_full' ? new StorageFull() : new TooLarge();
  if (status === 404) return new NotSynced();
  if (status === 403 && code === 'clone_unavailable') return new CloneUnavailable();
  return undefined;
}

function cloneError(status: number, code: string): Error | undefined {
  if (status === 409) return new CloneUnavailableNow();
  if (status === 403) return code === 'needs_paid_plan' ? new NeedsPaidPlan() : new CloneUnavailable();
  return undefined;
}

/** Longer than the function's own 120 s text-to-speech wait, which is followed by storage work. */
const SPEAK_TIMEOUT_MS = 180_000;

export class CloudAsrClient {
  constructor(private readonly d: Deps) {}

  /**
   * clean: leave out filler words and false starts (dictation, and voice notes while "Clean up voice notes" is on).
   * keyterms: the user's custom words. `usage`: the month so far, when the function says.
   */
  async transcribe(
    audio: Uint8Array,
    language: string | null,
    signal?: AbortSignal,
    clean = false,
    keyterms: string[] = [],
  ): Promise<{ text: string; language: string | null; ms?: TranscribeResponse['ms']; usage?: CloudUsage }> {
    const body = trimWav(audio, MAX_SECONDS);
    const params = new URLSearchParams({
      ...(language ? { language } : {}),
      ...(clean ? { clean: '1' } : {}),
      ...(keyterms.length ? { keyterms: JSON.stringify(keyterms) } : {}),
    }).toString();
    const r = await this.call<TranscribeResponse>(`/transcribe${params ? `?${params}` : ''}`, { method: 'POST', body, contentType: 'audio/wav', signal });
    return { text: typeof r.text === 'string' ? r.text : '', language: language ?? twoLetter(r.language), ms: r.ms, usage: usageOf(r) };
  }

  usage(): Promise<UsageResponse> {
    return this.call<UsageResponse>('/usage', { method: 'GET' });
  }

  /** Reads a note aloud; the function stores the MP3 beside the recording. */
  speak(req: SpeakRequest): Promise<SpeakResponse> {
    return this.call<SpeakResponse>('/speak', {
      method: 'POST',
      body: JSON.stringify(req),
      contentType: 'application/json',
      mapError: speakError,
      timeoutMs: SPEAK_TIMEOUT_MS,
    });
  }

  voice(): Promise<VoiceState> {
    return this.call<VoiceState>('/voice', { method: 'GET' });
  }

  /** `wav`: 30-180 s of the user's own voice. `consent=1` is sent only for `true`; the server refuses without it. */
  clone(wav: Uint8Array, consent: boolean): Promise<VoiceState> {
    return this.call<VoiceState>(`/voice/clone${consent === true ? '?consent=1' : ''}`, { method: 'POST', body: wav, contentType: 'audio/wav', mapError: cloneError });
  }

  removeClone(): Promise<VoiceState> {
    return this.call<VoiceState>('/voice/remove', { method: 'POST' });
  }

  /** A stock voice's sample MP3 (made once by the server). */
  async sample(voiceId: string): Promise<Uint8Array> {
    const res = await this.ok(`/voice/sample/${encodeURIComponent(voiceId)}`, { method: 'GET' });
    try {
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      throw new ProviderFailed();
    }
  }

  private async call<T>(path: string, o: CallOptions): Promise<T> {
    const res = await this.ok(path, o);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderFailed(); // a captive portal or proxy page
    }
  }

  /** The reply to a request that succeeded; the others become typed errors. */
  private async ok(path: string, o: CallOptions): Promise<Response> {
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
    if (!res.ok) {
      const code = o.mapError ? (((await res.json().catch(() => ({}))) as { error?: unknown }).error ?? '') : '';
      throw o.mapError?.(res.status, String(code)) ?? (res.status === 413 ? new TooLarge() : new ProviderFailed());
    }
    return res;
  }

  private async send(path: string, o: CallOptions): Promise<Response> {
    const token = await this.d.token();
    if (!token) throw new CloudNotSignedIn();
    const timeout = AbortSignal.timeout(o.timeoutMs ?? this.d.timeoutMs ?? 120_000);
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
