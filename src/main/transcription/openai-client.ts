import { normaliseLanguage } from '../../shared/transcription';
import {
  type TranscriptionFailure,
  transcriptionError,
} from '../../shared/transcription-errors';

export type TranscribeRequest = {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  language: string | null; // null = let the model detect it
  audio: Uint8Array;
  filename: string;
  timeoutMs?: number;
};

export type TranscribeResult = { text: string; language: string | null };

export class TranscriptionFailed extends Error {
  constructor(readonly failure: TranscriptionFailure) {
    super(transcriptionError(failure));
  }
}

const TIMEOUT_MS = 10 * 60_000;

/** POST {baseUrl}/audio/transcriptions, the OpenAI shape that vLLM, speaches, Groq etc. all accept. */
export async function transcribe(
  req: TranscribeRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscribeResult> {
  const attempt = (format: 'verbose_json' | 'json') => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(req.audio)], req.filename, {
        type: 'audio/wav',
      }),
    );
    form.append('model', req.model);
    form.append('response_format', format);
    if (req.language) form.append('language', req.language);
    return send(fetchImpl, `${req.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
    });
  };
  let res = await attempt('verbose_json');
  // verbose_json carries the detected language, but some vLLM versions only accept json.
  if (res.status === 400 || res.status === 422) res = await attempt('json');
  const body = await res.text();
  if (!res.ok)
    throw new TranscriptionFailed({ kind: 'http', status: res.status, body });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TranscriptionFailed({ kind: 'bad-response' });
  }
  const { text, language } = (parsed ?? {}) as {
    text?: unknown;
    language?: unknown;
  };
  if (typeof text !== 'string')
    throw new TranscriptionFailed({ kind: 'bad-response' });
  return { text, language: req.language ?? normaliseLanguage(language) };
}

async function send(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    const timedOut =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new TranscriptionFailed({ kind: timedOut ? 'timeout' : 'network' });
  }
}
