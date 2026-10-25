import { expect, it } from 'vitest';
import {
  transcribe,
  TranscriptionFailed,
  type TranscribeRequest,
} from '../../src/main/transcription/openai-client';

type Call = { url: string; headers: Headers; form: FormData };

/** A fetch that answers from `replies` in order and records every request. */
function fakeFetch(replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      form: await new Response(init.body).formData(),
    });
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return reply;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  });

const req = (over: Partial<TranscribeRequest> = {}): TranscribeRequest => ({
  baseUrl: 'https://vm/v1',
  model: 'openai/whisper-large-v3',
  apiKey: 'k',
  language: null,
  audio: new Uint8Array([1, 2, 3]),
  filename: 'n.wav',
  ...over,
});

it('posts the WAV, model and verbose_json with the bearer key', async () => {
  const f = fakeFetch([json(200, { text: 'hola' })]);
  await transcribe(req(), f.impl);
  const [c] = f.calls;
  expect(c.url).toBe('https://vm/v1/audio/transcriptions');
  expect(c.headers.get('authorization')).toBe('Bearer k');
  expect(c.form.get('model')).toBe('openai/whisper-large-v3');
  expect(c.form.get('response_format')).toBe('verbose_json');
  expect(c.form.has('language')).toBe(false);
  const file = c.form.get('file') as File;
  expect(file.name).toBe('n.wav');
  expect(file.type).toBe('audio/wav');
  expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
});

it('omits the key header without a key and sends a chosen language', async () => {
  const f = fakeFetch([json(200, { text: 'hola' })]);
  await transcribe(req({ apiKey: null, language: 'es' }), f.impl);
  expect(f.calls[0].headers.has('authorization')).toBe(false);
  expect(f.calls[0].form.get('language')).toBe('es');
});

it('returns the text untrimmed and the detected language as a code', async () => {
  const f = fakeFetch([json(200, { text: ' hola ', language: 'spanish' })]);
  expect(await transcribe(req(), f.impl)).toEqual({
    text: ' hola ',
    language: 'es',
  });
});

it('reports the requested language over the detected one', async () => {
  const f = fakeFetch([json(200, { text: 'hola', language: 'spanish' })]);
  expect(await transcribe(req({ language: 'fr' }), f.impl)).toEqual({
    text: 'hola',
    language: 'fr',
  });
});

it.each([400, 422])(
  'retries once with json when verbose_json gets %i',
  async (status) => {
    const f = fakeFetch([
      json(status, { detail: 'bad format' }),
      json(200, { text: 'hi' }),
    ]);
    expect(await transcribe(req(), f.impl)).toEqual({
      text: 'hi',
      language: null,
    });
    expect(f.calls.map((c) => c.form.get('response_format'))).toEqual([
      'verbose_json',
      'json',
    ]);
  },
);

it('reports the retry error, not the first one', async () => {
  const f = fakeFetch([json(400, 'x'), json(401, 'no')]);
  await expect(transcribe(req(), f.impl)).rejects.toThrow('API key rejected');
  expect(f.calls).toHaveLength(2);
});

it('does not retry server errors', async () => {
  const f = fakeFetch([
    json(500, { error: { message: 'CUDA out of memory' } }),
  ]);
  const err = await transcribe(req(), f.impl).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TranscriptionFailed);
  expect((err as Error).message).toBe('Server error 500: CUDA out of memory');
  expect(f.calls).toHaveLength(1);
});

it('maps network failures and timeouts', async () => {
  const net = fakeFetch([new TypeError('fetch failed')]);
  await expect(transcribe(req(), net.impl)).rejects.toThrow(
    "Can't reach the server",
  );
  const slow = fakeFetch([new DOMException('timed out', 'TimeoutError')]);
  await expect(transcribe(req(), slow.impl)).rejects.toThrow('Timed out');
});

it.each(['not json', '{"nope":1}'])(
  'rejects an unusable success body: %s',
  async (body) => {
    const f = fakeFetch([json(200, body)]);
    await expect(transcribe(req(), f.impl)).rejects.toThrow(
      'Unexpected response from the server',
    );
  },
);
