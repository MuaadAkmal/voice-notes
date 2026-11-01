import { expect, it } from 'vitest';
import { canonicalWav } from '../../../src/shared/asr/core';
import { elevenLabsTranscriber } from '../../../src/shared/asr/elevenlabs';

const pcm = new Uint8Array([1, 2, 3, 4]);
const wav = canonicalWav(pcm, 44100, 2);
const opts = (clean = false) => ({ clean, signal: new AbortController().signal });
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
  const out = await elevenLabsTranscriber('KEY', f)(wav, 'en', opts());
  expect(out).toEqual({ text: 'hi', language: 'eng' });
  expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
  expect((calls[0].init.headers as Record<string, string>)['xi-api-key']).toBe('KEY');
  const form = calls[0].init.body as FormData;
  expect(form.get('model_id')).toBe('scribe_v2');
  expect(form.get('language_code')).toBe('en');
  expect((form.get('file') as File).name).toBe('audio.wav');
  expect(form.has('file_format')).toBe(false);
  expect(form.has('no_verbatim')).toBe(false);
});

it('omits language_code when none is given', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  const out = await elevenLabsTranscriber('K', f)(wav, null, opts());
  expect(out).toEqual({ text: 'x', language: null });
  expect((calls[0].init.body as FormData).has('language_code')).toBe(false);
});

it('asks for no filler words only when told to', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  await elevenLabsTranscriber('K', f)(wav, null, opts(true));
  expect((calls[0].init.body as FormData).get('no_verbatim')).toBe('true');
});

it('sends a 16 kHz mono clip as raw samples, without its header', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  await elevenLabsTranscriber('K', f)(canonicalWav(pcm, 16000, 1), null, opts());
  const form = calls[0].init.body as FormData;
  expect(form.get('file_format')).toBe('pcm_s16le_16');
  expect([...new Uint8Array(await (form.get('file') as File).arrayBuffer())]).toEqual([...pcm]);
});

it('keeps the WAV for 16 kHz stereo', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  await elevenLabsTranscriber('K', f)(canonicalWav(pcm, 16000, 2), null, opts());
  expect((calls[0].init.body as FormData).has('file_format')).toBe(false);
});

it('stops when cancelled', async () => {
  const { f, calls } = fake(new Response(JSON.stringify({ text: 'x' })));
  const cancel = new AbortController();
  await elevenLabsTranscriber('K', f)(wav, null, { clean: false, signal: cancel.signal });
  cancel.abort();
  expect(calls[0].init.signal?.aborted).toBe(true);
});

it('throws on a non-2xx reply', async () => {
  const { f } = fake(new Response('nope', { status: 500 }));
  await expect(elevenLabsTranscriber('K', f)(wav, null, opts())).rejects.toThrow();
});
