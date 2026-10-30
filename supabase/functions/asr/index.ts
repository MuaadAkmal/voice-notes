// The `asr` Edge Function (cloud transcription): checks the clip, meters the month's seconds and
// sends it to ElevenLabs Scribe. The rules and request handling live in ./_shared (copies of
// src/shared, made by `npm run sync:function`). The ElevenLabs key stays here.
// Same shape as `commands`: usage goes through the REST API (no database connection to open) and
// tokens are checked against the project's signing keys from the environment.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLocalJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { AsrCore } from './_shared/asr/core.ts';
import { elevenLabsTranscriber } from './_shared/asr/elevenlabs.ts';
import { handleAsr } from './_shared/asr/handler.ts';
import { RestAsrStore } from './_shared/asr/pg-store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const missing = [...(apiKey ? [] : ['ELEVENLABS_API_KEY']), ...(serviceKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY'])];

const auth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core = missing.length
  ? null
  : new AsrCore({
      store: new RestAsrStore({ url: SUPABASE_URL, serviceKey, fetch }),
      transcribe: elevenLabsTranscriber(apiKey, fetch),
      now: Date.now,
    });

// The project's public signing keys, as the platform provides them; null if absent or unreadable.
const localKeys = (() => {
  try {
    const raw = JSON.parse(Deno.env.get('SUPABASE_JWKS') ?? '');
    return createLocalJWKSet(Array.isArray(raw?.keys) ? raw : { keys: Array.isArray(raw) ? raw : [raw] });
  } catch {
    return null;
  }
})();

async function verify(jwt: string): Promise<{ userId: string } | null> {
  if (localKeys) {
    try {
      const { payload } = await jwtVerify(jwt, localKeys, { issuer: `${SUPABASE_URL}/auth/v1` });
      return payload.sub && payload.role === 'authenticated' ? { userId: payload.sub } : null;
    } catch {
      // A key the environment doesn't have yet (rotation) or a legacy token: let Auth decide.
    }
  }
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return { userId: data.claims.sub as string };
}

Deno.serve((req) => handleAsr(req, { verify, core, missing }));
