import type { Transcriber } from './core.ts';
import type { Speaker } from './speak.ts';
import { CloneRefused, type VoiceApi } from './voice.ts';

// ElevenLabs Scribe speech-to-text. The key stays in the Edge Function.

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const HEADER_BYTES = 44; // canonicalWav's header
const TIMEOUT_MS = 60_000;
const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const TTS_TIMEOUT_MS = 120_000;

/** Dictation clips are 16 kHz mono: sent raw, ElevenLabs skips decoding them, which its docs say is faster. */
const isPcm16k = (wav: Uint8Array) => {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return wav.length > HEADER_BYTES && v.getUint32(24, true) === 16000 && v.getUint16(22, true) === 1;
};

export function elevenLabsTranscriber(apiKey: string, fetchFn: typeof globalThis.fetch): Transcriber {
  return async (wav, language, { clean, keyterms, signal }) => {
    const form = new FormData();
    form.set('model_id', 'scribe_v2');
    if (language) form.set('language_code', language);
    if (clean) form.set('no_verbatim', 'true');
    for (const term of keyterms) form.append('keyterms', term); // 20% more per request, so only when the user has words
    if (isPcm16k(wav)) {
      form.set('file_format', 'pcm_s16le_16');
      form.set('file', new Blob([wav.subarray(HEADER_BYTES) as BlobPart], { type: 'application/octet-stream' }), 'audio.pcm');
    } else {
      form.set('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'audio.wav');
    }
    const res = await fetchFn(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const j = (await res.json()) as { text?: unknown; language_code?: unknown };
    return { text: typeof j.text === 'string' ? j.text : '', language: typeof j.language_code === 'string' ? j.language_code : null };
  };
}

export function elevenLabsSpeaker(apiKey: string, fetchFn: typeof globalThis.fetch): Speaker {
  return async (voiceId, text, signal) => {
    const res = await fetchFn(`${TTS_URL}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TTS_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}

const VOICES_URL = 'https://api.elevenlabs.io/v1/voices';
const VOICES_TIMEOUT_MS = 60_000;

export function elevenLabsVoices(apiKey: string, fetchFn: typeof globalThis.fetch): VoiceApi {
  const previews = new Map<string, string | null>(); // stock previews don't change
  const fail = async (res: Response) => `ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
  return {
    async create(name, wav) {
      const form = new FormData();
      form.set('name', name);
      form.set('remove_background_noise', 'true');
      form.append('files', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'sample.wav');
      const res = await fetchFn(`${VOICES_URL}/add`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
        signal: AbortSignal.timeout(VOICES_TIMEOUT_MS),
      });
      if (!res.ok) {
        const msg = await fail(res);
        // Out of slots or quota, or the sample was refused: not a fault of ours, so the user sees "not available".
        if ([400, 402, 403, 409, 422].includes(res.status) || /limit|quota/i.test(msg)) throw new CloneRefused(msg);
        throw new Error(msg);
      }
      const j = (await res.json()) as { voice_id?: unknown };
      if (typeof j.voice_id !== 'string' || !j.voice_id) throw new Error('ElevenLabs returned no voice id');
      return j.voice_id;
    },
    async remove(voiceId) {
      const res = await fetchFn(`${VOICES_URL}/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(VOICES_TIMEOUT_MS),
      });
      if (!res.ok && res.status !== 404) throw new Error(await fail(res));
    },
    async preview(voiceId) {
      if (previews.has(voiceId)) return previews.get(voiceId) ?? null;
      const res = await fetchFn(`${VOICES_URL}/${encodeURIComponent(voiceId)}`, {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(VOICES_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(await fail(res));
      const j = (await res.json()) as { preview_url?: unknown };
      const url = typeof j.preview_url === 'string' ? j.preview_url : null;
      previews.set(voiceId, url);
      return url;
    },
  };
}
