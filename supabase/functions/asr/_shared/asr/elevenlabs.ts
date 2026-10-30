import type { Transcriber } from './core.ts';

// ElevenLabs Scribe speech-to-text. The key stays in the Edge Function.

const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export function elevenLabsTranscriber(apiKey: string, fetchFn: typeof globalThis.fetch): Transcriber {
  return async (wav, language) => {
    const form = new FormData();
    form.set('model_id', 'scribe_v2');
    if (language) form.set('language_code', language);
    form.set('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'audio.wav');
    const res = await fetchFn(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const j = (await res.json()) as { text?: unknown; language_code?: unknown };
    return { text: typeof j.text === 'string' ? j.text : '', language: typeof j.language_code === 'string' ? j.language_code : null };
  };
}
