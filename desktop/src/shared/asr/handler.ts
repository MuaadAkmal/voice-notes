import { type AsrCore, BadAudio, ProviderFailed, QuotaExceeded, TooLarge } from './core';
import { normalizeWords } from '../custom-words';
import { MAX_BYTES } from './protocol';
import { BadSpeak, CloneUnavailable, NotYourNote, StorageFull, type SpeakCore } from './speak';
import { BadSamples, CloneUnavailableNow, NeedsPaidPlan, NoConsent, type VoiceCore } from './voice';

// The `asr` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// The account always comes from the verified token. Errors say what kind, never the internals
// (a ProviderFailed message carries the provider's own text and is only logged).

export type AsrHandlerDeps = {
  /** The user for a valid access token, else null. */
  verify(jwt: string): Promise<{ userId: string } | null>;
  /** Null when a secret is missing. */
  core: Pick<AsrCore, 'transcribe' | 'usage'> | null;
  /** Null when a secret is missing. */
  speak: Pick<SpeakCore, 'speak'> | null;
  /** Null when a secret is missing. */
  voice: Pick<VoiceCore, 'state' | 'clone' | 'remove'> | null;
  missing: string[];
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The `keyterms` query (a JSON array of strings) cleaned as the app cleans it; anything else is none. */
function readKeyterms(raw: string | null): string[] {
  try {
    const list: unknown = JSON.parse(raw ?? '');
    return Array.isArray(list) ? normalizeWords(list.filter((t): t is string => typeof t === 'string')) : [];
  } catch {
    return [];
  }
}

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
  const parts = url.pathname.split('/');
  const last = parts.pop();
  const route = last && parts.at(-1) === 'voice' && (last === 'clone' || last === 'remove') ? `voice/${last}` : last;
  const post = req.method === 'POST';
  const known =
    (post && ['transcribe', 'speak', 'voice/clone', 'voice/remove'].includes(route ?? '')) ||
    (req.method === 'GET' && (route === 'usage' || route === 'voice'));
  if (!known) return json(404, { error: 'Not found' });
  const needsSpeak = route === 'speak';
  const needsVoice = route === 'voice' || route?.startsWith('voice/');
  if ((needsSpeak && !d.speak) || (needsVoice && !d.voice)) {
    console.error('[asr] missing secrets', d.missing.join(', '));
    return json(500, { error: 'misconfigured', missing: d.missing });
  }

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = jwt ? await d.verify(jwt).catch(() => null) : null;
  if (!user) return json(401, { error: 'Sign in again' });

  try {
    if (route === 'usage') return json(200, await d.core.usage(user.userId));
    if (route === 'voice') return json(200, await d.voice!.state(user.userId));
    if (route === 'voice/remove') return json(200, await d.voice!.remove(user.userId));
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return json(413, { error: 'too_large' });
    const body = await readCapped(req).catch(() => new Uint8Array(0));
    if (!body) return json(413, { error: 'too_large' });
    if (route === 'speak') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(body));
      } catch {
        return json(400, { error: 'bad_request' });
      }
      return json(200, await d.speak!.speak(user.userId, parsed));
    }
    if (route === 'voice/clone') return json(200, await d.voice!.clone(user.userId, body, url.searchParams.get('consent') === '1'));
    const language = url.searchParams.get('language') || null;
    const keyterms = readKeyterms(url.searchParams.get('keyterms'));
    return json(200, await d.core.transcribe(user.userId, body, language, url.searchParams.get('clean') === '1', keyterms));
  } catch (err) {
    if (err instanceof BadAudio) return json(400, { error: 'bad_audio' });
    if (err instanceof TooLarge) return json(413, { error: 'too_large' });
    if (err instanceof QuotaExceeded) return json(429, { error: 'quota_exceeded', resetsAt: err.resetsAt });
    if (err instanceof StorageFull) return json(413, { error: 'storage_full' });
    if (err instanceof NotYourNote) return json(404, { error: 'not_found' });
    if (err instanceof BadSpeak || err instanceof BadSamples || err instanceof NoConsent) return json(400, { error: 'bad_request' });
    if (err instanceof CloneUnavailable || err instanceof NeedsPaidPlan) return json(403, { error: err instanceof NeedsPaidPlan ? 'needs_paid_plan' : 'clone_unavailable' });
    if (err instanceof CloneUnavailableNow) return json(409, { error: 'unavailable' });
    if (err instanceof ProviderFailed) {
      console.error('[asr] provider', err.message);
      return json(502, { error: 'provider_failed' });
    }
    console.error('[asr]', err instanceof Error ? err.message : err);
    return json(500, { error: 'Server error' });
  }
}
