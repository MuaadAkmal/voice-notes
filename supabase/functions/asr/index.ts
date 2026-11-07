// The `asr` Edge Function (cloud transcription): checks the clip, meters the month's seconds and
// sends it to ElevenLabs Scribe. The rules and request handling live in ./_shared (copies of
// src/shared, made by `npm run sync:function`). The ElevenLabs key stays here.
// Same shape as `commands`: usage goes through the REST API (no database connection to open) and
// tokens are checked against the project's signing keys from the environment.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLocalJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { AsrCore } from './_shared/asr/core.ts';
import { elevenLabsSpeaker, elevenLabsTranscriber, elevenLabsVoices } from './_shared/asr/elevenlabs.ts';
import { handleAsr } from './_shared/asr/handler.ts';
import { RestAsrStore, RestCloneStore, RestSpeakFiles } from './_shared/asr/pg-store.ts';
import { SampleCore } from './_shared/asr/samples.ts';
import { SpeakCore } from './_shared/asr/speak.ts';
import { VoiceCore, cloneLimitFor } from './_shared/asr/voice.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const apiKey = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const missing = [...(apiKey ? [] : ['ELEVENLABS_API_KEY']), ...(serviceKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY'])];

const auth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const store = new RestAsrStore({ url: SUPABASE_URL, serviceKey, fetch });
const core = missing.length
  ? null
  : new AsrCore({
      store,
      transcribe: elevenLabsTranscriber(apiKey, fetch),
      now: Date.now,
    });

// Polished audio and voice cloning. Cloning stays off until ELEVENLABS_VOICE_SLOTS (the custom voice slots the ElevenLabs plan has) is set; one stays spare.
const rest = { url: SUPABASE_URL, serviceKey, fetch };
const storage = missing.length ? null : createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
const speakFiles = new RestSpeakFiles(rest);
const voice = missing.length
  ? null
  : new VoiceCore({
      store,
      clones: new RestCloneStore(rest),
      api: elevenLabsVoices(apiKey, fetch),
      limit: cloneLimitFor(Number(Deno.env.get('ELEVENLABS_VOICE_SLOTS'))),
      now: Date.now,
    });
const speak =
  missing.length || !voice || !storage
    ? null
    : new SpeakCore({
        store,
        speaker: elevenLabsSpeaker(apiKey, fetch),
        files: {
          owns: (user, noteId) => speakFiles.owns(user, noteId),
          reserve: (user, path, bytes) => speakFiles.reserve(user, path, bytes),
          async upload(path, mp3) {
            const { error } = await storage.from('audio').upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
            if (error) throw new Error(`upload: ${error.message}`);
          },
        },
        clone: voice.usableClone,
        now: Date.now,
      });

// Stock voice samples: made once with the speaker above, kept in Storage outside every <userId>/ folder
// (so the per-user sweep and storage_reserve never see them), served from then on.
const SAMPLE_PREFIX = '_samples/eleven_multilingual_v2';
const samples =
  missing.length || !storage
    ? null
    : new SampleCore({
        speaker: elevenLabsSpeaker(apiKey, fetch),
        store: {
          async get(voiceId) {
            const { data, error } = await storage.from('audio').download(`${SAMPLE_PREFIX}/${voiceId}.mp3`);
            if (error || !data) return null; // not made yet (or unreadable: it is made again)
            return new Uint8Array(await data.arrayBuffer());
          },
          async put(voiceId, mp3) {
            const { error } = await storage.from('audio').upload(`${SAMPLE_PREFIX}/${voiceId}.mp3`, mp3, { contentType: 'audio/mpeg', upsert: true });
            if (error) throw new Error(`upload: ${error.message}`);
          },
        },
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
      return payload.sub && payload.role === 'authenticated' && payload.is_anonymous !== true ? { userId: payload.sub } : null;
    } catch {
      // A key the environment doesn't have yet (rotation) or a legacy token: let Auth decide.
    }
  }
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated' || data.claims.is_anonymous === true) return null;
  return { userId: data.claims.sub as string };
}

Deno.serve((req) => handleAsr(req, { verify, core, speak, voice, samples, missing }));
