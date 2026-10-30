import { type AsrCore, BadAudio, ProviderFailed, QuotaExceeded, TooLarge } from './core.ts';
import { MAX_BYTES } from './protocol.ts';

// The `asr` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// The account always comes from the verified token. Errors say what kind, never the internals
// (a ProviderFailed message carries the provider's own text and is only logged).

export type AsrHandlerDeps = {
  /** The user for a valid access token, else null. */
  verify(jwt: string): Promise<{ userId: string } | null>;
  /** Null when a secret is missing. */
  core: Pick<AsrCore, 'transcribe' | 'usage'> | null;
  missing: string[];
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The body, or null as soon as it passes MAX_BYTES. */
async function readCapped(req: Request): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function handleAsr(req: Request, d: AsrHandlerDeps): Promise<Response> {
  if (!d.core) {
    console.error('[asr] missing secrets', d.missing.join(', '));
    return json(500, { error: 'misconfigured', missing: d.missing });
  }
  const url = new URL(req.url);
  const route = url.pathname.split('/').pop();
  const isTranscribe = req.method === 'POST' && route === 'transcribe';
  const isUsage = req.method === 'GET' && route === 'usage';
  if (!isTranscribe && !isUsage) return json(404, { error: 'Not found' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = jwt ? await d.verify(jwt).catch(() => null) : null;
  if (!user) return json(401, { error: 'Sign in again' });

  try {
    if (isUsage) return json(200, await d.core.usage(user.userId));
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return json(413, { error: 'too_large' });
    const body = await readCapped(req).catch(() => new Uint8Array(0));
    if (!body) return json(413, { error: 'too_large' });
    const language = url.searchParams.get('language') || null;
    return json(200, await d.core.transcribe(user.userId, body, language));
  } catch (err) {
    if (err instanceof BadAudio) return json(400, { error: 'bad_audio' });
    if (err instanceof TooLarge) return json(413, { error: 'too_large' });
    if (err instanceof QuotaExceeded) return json(429, { error: 'quota_exceeded', resetsAt: err.resetsAt });
    if (err instanceof ProviderFailed) {
      console.error('[asr] provider', err.message);
      return json(502, { error: 'provider_failed' });
    }
    console.error('[asr]', err instanceof Error ? err.message : err);
    return json(500, { error: 'Server error' });
  }
}
