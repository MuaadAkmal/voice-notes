import { expect, it } from 'vitest';
import { elevenLabsTranscriber } from '../../../src/shared/asr/elevenlabs';

const wav = new Uint8Array([1, 2, 3]);
function fake(res: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res;
  }) as unknown as typeof fetch;
  return { f, calls };
}

it('posts the clip to Scribe and maps the reply', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'hi', language_code: 'eng' })));
  const out = await elevenLabsTranscriber('KEY', f)(wav, 'en');
  expect(out).toEqual({ text: 'hi', language: 'eng' });
  expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
  expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
  const form = calls[0].init.body as FormData;
  expect(form.get('model_id')).toBe('scribe_v2');
  expect(form.get('language_code')).toBe('en');
  expect((form.get('file') as File).name).toBe('audio.wav');
});

it('omits language_code when none is given', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  const out = await elevenLabsTranscriber('K', f)(wav, null);
  expect(out).toEqual({ text: 'x', language: null });
  expect((calls[0].init.body as FormData).has('language_code')).toBe(false);
});

it('throws on a non-2xx reply', async () => {
  const { f } = fake(new Response('nope', { status: 500 }));
  await expect(elevenLabsTranscriber('K', f)(wav, null)).rejects.toThrow();
});
