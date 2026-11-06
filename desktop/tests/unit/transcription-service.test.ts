import { describe, expect, it, vi } from 'vitest';
import type { Note, Settings } from '../../src/shared/channels';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import {
  type TranscribeRequest,
  TranscriptionFailed,
} from '../../src/main/transcription/openai-client';
import {
  CLEANUP_TIMEOUT_MS,
  type ServiceDeps,
  TranscriptionService,
} from '../../src/main/transcription/service';
import { POLISH_MAX_TOKENS, POLISH_TIMEOUT_MS } from '../../src/shared/commands/polish';
import { resolveEndpoint } from '../../src/main/transcription/endpoint';
import { QuotaExceeded } from '../../src/main/transcription/cloud-client';
import { silentWav } from '../../src/shared/wav';

const ID = '123e4567-e89b-42d3-a456-426614174000';

const note = (over: Partial<Note> = {}): Note => ({
  id: ID,
  title: 'n',
  filePath: `recordings/${ID}.webm`,
  durationMs: 1000,
  sizeBytes: 1,
  mimeType: 'audio/webm;codecs=opus',
  status: 'ok',
  createdAt: 0,
  updatedAt: 0,
  syncedAt: null,
  folderId: null,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  transcript: null,
  transcriptLang: null,
  transcribedAt: null,
  ...over,
});

const serverSettings = (
  over: Partial<Settings['transcription']> = {},
): Settings => ({
  ...DEFAULT_SETTINGS,
  transcription: {
    provider: 'server',
    baseUrl: 'https://vm/v1',
    model: 'm',
    localModel: null,
    ...over,
  },
});

/** Every dependency faked; `over` replaces any of them. */
function setup(over: Partial<ServiceDeps> = {}) {
  let settings = serverSettings();
  let key: string | null = 'k';
  const requests: TranscribeRequest[] = [];
  const local = { ensure: vi.fn(async () => 'http://127.0.0.1:1/v1'), release: vi.fn() };
  const deps: ServiceDeps = {
    store: {
      get: vi.fn(() => note()),
      absolutePath: (n: Note) => `C:/data/${n.filePath}`,
      setTranscript: vi.fn((id: string, text: string, lang: string | null) =>
        note({ id, transcript: text, transcriptLang: lang }),
      ),
    },
    endpoint: () => resolveEndpoint({ settings: () => settings, secrets: { get: () => key }, local }),
    secrets: { get: () => key },
    toWav: vi.fn(async () => new Uint8Array([9])),
    readFile: vi.fn(async () => new Uint8Array([1, 2])),
    transcribe: vi.fn(async (req: TranscribeRequest) => {
      requests.push(req);
      return { text: '  hola  ', language: 'es' };
    }),
    now: () => 0,
    notesChanged: vi.fn(),
    onStatus: vi.fn(),
    ...over,
  };
  const service = new TranscriptionService(deps);
  return {
    service,
    deps,
    requests,
    local,
    setSettings: (s: Settings) => (settings = s),
    setKey: (k: string | null) => (key = k),
  };
}

it('converts, sends and saves a trimmed transcript', async () => {
  const { service, deps, requests } = setup();
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(deps.readFile).toHaveBeenCalledWith(`C:/data/recordings/${ID}.webm`);
  expect(deps.toWav).toHaveBeenCalledWith(
    new Uint8Array([1, 2]),
    'audio/webm;codecs=opus',
  );
  expect(requests).toEqual([
    {
      baseUrl: 'https://vm/v1',
      model: 'm',
      apiKey: 'k',
      language: null,
      audio: new Uint8Array([9]),
      filename: `${ID}.wav`,
    },
  ]);
  expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, 'hola', 'es');
  expect(deps.notesChanged).toHaveBeenCalled();
  expect(service.status()).toEqual({});
});

it('sends the custom words to a server as its prompt, for notes and peeks', async () => {
  const { service, deps, requests } = setup({ words: () => ['Muaad', 'Pixie'] });
  service.enqueue([ID], 'auto');
  await service.idle();
  (deps.toWav as ReturnType<typeof vi.fn>).mockResolvedValueOnce(silentWav(10));
  await service.peek(ID, 4);
  expect(requests.map((r) => r.prompt)).toEqual(['Glossary: Muaad, Pixie.', 'Glossary: Muaad, Pixie.']);
});

it('sends the custom words to the cloud as key terms', async () => {
  const cloud = { transcribe: vi.fn(async () => ({ text: 'x', language: 'en' })) };
  const { service, setSettings } = setup({ cloud, words: () => ['Muaad'] });
  setSettings(serverSettings({ provider: 'cloud', baseUrl: '' }));
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(cloud.transcribe).toHaveBeenCalledWith(new Uint8Array([9]), null, undefined, false, ['Muaad']);
});

it('passes a chosen language', async () => {
  const { service, requests } = setup();
  service.enqueue([ID], 'es');
  await service.idle();
  expect(requests[0].language).toBe('es');
});

it('reads settings and key when the job starts, not when queued', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = '223e4567-e89b-42d3-a456-426614174000';
  const t = setup({
    toWav: vi.fn(async () => {
      await gate;
      return new Uint8Array([9]);
    }),
  });
  t.service.enqueue([first, ID], 'auto');
  t.setSettings(serverSettings({ baseUrl: 'https://new/v1', model: 'm2' }));
  t.setKey('k2');
  release();
  await t.service.idle();
  expect(t.requests[1]).toMatchObject({
    baseUrl: 'https://new/v1',
    model: 'm2',
    apiKey: 'k2',
  });
});

it('fails when the audio is missing', async () => {
  const missing = setup({
    store: { ...setup().deps.store, get: () => note({ status: 'missing' }) },
  });
  missing.service.enqueue([ID], 'auto');
  await missing.service.idle();
  expect(missing.service.status()).toEqual({
    [ID]: { state: 'failed', error: 'Audio file is missing' },
  });

  const gone = setup({
    readFile: async () =>
      Promise.reject(Object.assign(new Error('nope'), { code: 'ENOENT' })),
  });
  gone.service.enqueue([ID], 'auto');
  await gone.service.idle();
  expect(gone.service.status()).toEqual({
    [ID]: { state: 'failed', error: 'Audio file is missing' },
  });
});

it('fails when transcription is not set up', async () => {
  const t = setup();
  t.setSettings(DEFAULT_SETTINGS);
  t.service.enqueue([ID], 'auto');
  await t.service.idle();
  expect(t.service.status()).toEqual({
    [ID]: { state: 'failed', error: 'Set up transcription first' },
  });
});

it('drops a job whose note was deleted before or during it', async () => {
  const before = setup({
    store: { ...setup().deps.store, get: () => undefined },
  });
  before.service.enqueue([ID], 'auto');
  await before.service.idle();
  expect(before.deps.transcribe).not.toHaveBeenCalled();
  expect(before.service.status()).toEqual({});

  const during = setup({
    store: {
      ...setup().deps.store,
      setTranscript: () => {
        throw new Error('Note not found');
      },
    },
  });
  during.service.enqueue([ID], 'auto');
  await during.service.idle();
  expect(during.service.status()).toEqual({});
});

it('shows server and conversion errors on the note', async () => {
  const server = setup({
    transcribe: async () =>
      Promise.reject(
        new TranscriptionFailed({ kind: 'http', status: 401, body: '' }),
      ),
  });
  server.service.enqueue([ID], 'auto');
  await server.service.idle();
  expect(server.service.status()).toEqual({
    [ID]: { state: 'failed', error: 'API key rejected' },
  });

  const decode = setup({
    toWav: async () => Promise.reject(new Error("Couldn't read the audio")),
  });
  decode.service.enqueue([ID], 'auto');
  await decode.service.idle();
  expect(decode.service.status()).toEqual({
    [ID]: { state: 'failed', error: "Couldn't read the audio" },
  });
});

it('broadcasts status changes', async () => {
  const { service, deps } = setup();
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(deps.onStatus).toHaveBeenCalledWith({ [ID]: { state: 'running' } });
  expect(deps.onStatus).toHaveBeenLastCalledWith({});
});

it('tests a connection with a second of silence', async () => {
  let clock = 1000;
  const t = setup({
    now: () => clock,
    transcribe: vi.fn(async () => {
      clock += 800;
      return { text: '', language: 'en' };
    }),
  });
  expect(await t.service.test('https://vm/v1', 'm')).toEqual({
    ok: true,
    ms: 800,
    language: 'en',
  });
  expect(t.deps.transcribe).toHaveBeenCalledWith({
    baseUrl: 'https://vm/v1',
    model: 'm',
    apiKey: 'k',
    language: null,
    audio: silentWav(1),
    filename: 'test.wav',
  });
});

it('reports a failed connection test', async () => {
  const t = setup({
    transcribe: async () =>
      Promise.reject(new TranscriptionFailed({ kind: 'network' })),
  });
  expect(await t.service.test('https://vm/v1', 'm')).toEqual({
    ok: false,
    error: "Can't reach the server",
  });
});

it('stores no speech when the transcript is only markers', async () => {
  const t = setup({ transcribe: vi.fn(async () => ({ text: ' [BLANK_AUDIO]\n', language: 'en' })) });
  t.service.enqueue([ID], 'auto');
  await t.service.idle();
  expect(t.deps.store.setTranscript).toHaveBeenCalledWith(ID, '', 'en');
});

it('transcribes through the built-in engine and releases it after success and failure', async () => {
  const t = setup();
  t.setSettings(serverSettings({ provider: 'local', localModel: 'base' }));
  t.service.enqueue([ID], 'auto');
  await t.service.idle();
  expect(t.local.ensure).toHaveBeenCalledWith('base');
  expect(t.requests[0]).toMatchObject({ baseUrl: 'http://127.0.0.1:1/v1', model: 'base', apiKey: null });
  expect(t.local.release).toHaveBeenCalledTimes(1);

  const failing = setup({ transcribe: async () => Promise.reject(new TranscriptionFailed({ kind: 'network' })) });
  failing.setSettings(serverSettings({ provider: 'local', localModel: 'base' }));
  failing.service.enqueue([ID], 'auto');
  await failing.service.idle();
  expect(failing.local.release).toHaveBeenCalledTimes(1);
});

it('gives a long note on the built-in engine time in proportion to its length', async () => {
  const thirtyMin = 30 * 60_000;
  const t = setup({ store: { ...setup().deps.store, get: () => note({ durationMs: thirtyMin }) } });
  t.setSettings(serverSettings({ provider: 'local', localModel: 'base' }));
  t.service.enqueue([ID], 'auto');
  await t.service.idle();
  expect(t.requests[0].timeoutMs).toBe(4 * thirtyMin);

  const short = setup();
  short.setSettings(serverSettings({ provider: 'local', localModel: 'base' }));
  short.service.enqueue([ID], 'auto');
  await short.service.idle();
  expect(short.requests[0].timeoutMs).toBe(10 * 60_000);

  const server = setup({ store: { ...setup().deps.store, get: () => note({ durationMs: thirtyMin }) } });
  server.service.enqueue([ID], 'auto');
  await server.service.idle();
  expect(server.requests[0].timeoutMs).toBeUndefined();
});

it('tests whatever provider is in use', async () => {
  const t = setup();
  t.setSettings(serverSettings({ provider: 'local', localModel: 'tiny' }));
  expect(await t.service.testCurrent()).toMatchObject({ ok: true });
  expect(t.requests[0]).toMatchObject({ baseUrl: 'http://127.0.0.1:1/v1', model: 'tiny', filename: 'test.wav' });
  expect(t.local.release).toHaveBeenCalledTimes(1);
});

it('a remote note is fetched before it is transcribed', async () => {
  let status: Note['status'] = 'remote';
  const fetchAudio = vi.fn(async () => void (status = 'ok'));
  const { service, deps } = setup({ fetchAudio });
  (deps.store.get as ReturnType<typeof vi.fn>).mockImplementation(() => note({ status }));
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(fetchAudio).toHaveBeenCalledWith(ID);
  expect(deps.store.setTranscript).toHaveBeenCalled();
});

it('sends notes, peeks and tests through the cloud client when the provider is cloud', async () => {
  const cloud = { transcribe: vi.fn(async () => ({ text: ' nube ', language: 'es' })) };
  const { service, deps, requests, setSettings } = setup({ cloud });
  setSettings(serverSettings({ provider: 'cloud', baseUrl: '' }));
  service.enqueue([ID], 'fr');
  await service.idle();
  expect(cloud.transcribe).toHaveBeenCalledWith(new Uint8Array([9]), 'fr', undefined, false, []);
  expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, 'nube', 'es');
  (deps.toWav as ReturnType<typeof vi.fn>).mockResolvedValueOnce(silentWav(10));
  expect(await service.peek(ID, 4)).toBe(' nube ');
  expect(await service.testCurrent()).toMatchObject({ ok: true, language: 'es' });
  expect(requests).toEqual([]);
});

it('reports the month’s usage from each cloud transcript', async () => {
  const usage = { used: 10, limit: 1800, resetsAt: 'r' };
  const cloud = { transcribe: vi.fn(async () => ({ text: 'x', language: 'en', usage })) };
  const onUsage = vi.fn();
  const { service, setSettings } = setup({ cloud, onUsage });
  setSettings(serverSettings({ provider: 'cloud', baseUrl: '' }));
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(onUsage).toHaveBeenCalledWith(usage);
});

it('reports a cloud refusal for minutes, and still fails the job', async () => {
  const cloud = { transcribe: vi.fn(async () => { throw new QuotaExceeded('2026-12-01T00:00:00.000Z'); }) };
  const onQuotaExceeded = vi.fn();
  const { service, setSettings } = setup({ cloud, onQuotaExceeded });
  setSettings(serverSettings({ provider: 'cloud', baseUrl: '' }));
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(onQuotaExceeded).toHaveBeenCalledWith('2026-12-01T00:00:00.000Z');
  expect(service.status()[ID]).toMatchObject({ state: 'failed' });
});

it('tells who wants to know once a transcript is saved', async () => {
  const onTranscribed = vi.fn();
  const { service } = setup({ onTranscribed });
  service.enqueue([ID], 'auto');
  await service.idle();
  expect(onTranscribed).toHaveBeenCalledWith(ID);
});

describe('cleanup of Cloud voice notes', () => {
  const SAID = 'um so the plan is uh to ship friday';
  function cloudSetup(o: { text?: string; polish?: (t: string, signal: AbortSignal) => Promise<string | null>; enabled?: () => boolean } = {}) {
    const cloud = { transcribe: vi.fn(async () => ({ text: o.text ?? SAID, language: 'en' })) };
    const cleanup = { enabled: vi.fn(o.enabled ?? (() => true)), polish: vi.fn(o.polish ?? (async () => 'The plan is to ship Friday.')) };
    const s = setup({ cloud, cleanup });
    s.setSettings(serverSettings({ provider: 'cloud', baseUrl: '' }));
    return { ...s, cloud, cleanup };
  }

  it('a cloud note is asked clean, then polished, and the polished text is saved', async () => {
    const { service, deps, cloud, cleanup } = cloudSetup();
    service.enqueue([ID], 'auto');
    await service.idle();
    expect(cloud.transcribe).toHaveBeenCalledWith(new Uint8Array([9]), null, undefined, true, []);
    expect(cleanup.polish).toHaveBeenCalledWith(SAID, expect.any(AbortSignal));
    expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, 'The plan is to ship Friday.', 'en');
  });

  it("keeps Scribe's text when polish gives nothing back or fails", async () => {
    for (const polish of [async () => null, async () => Promise.reject(new Error('offline'))]) {
      const { service, deps } = cloudSetup({ polish });
      service.enqueue([ID], 'auto');
      await service.idle();
      expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, SAID, 'en');
      expect(service.status()[ID]).not.toMatchObject({ state: 'failed' });
    }
  });

  it('saves short or empty transcripts without polishing', async () => {
    for (const text of ['ok thanks', '']) {
      const { service, deps, cleanup } = cloudSetup({ text });
      service.enqueue([ID], 'auto');
      await service.idle();
      expect(cleanup.polish).not.toHaveBeenCalled();
      expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, text, 'en');
    }
  });

  it('with the setting off, a cloud note is word for word', async () => {
    const { service, cloud, cleanup } = cloudSetup({ enabled: () => false });
    service.enqueue([ID], 'auto');
    await service.idle();
    expect(cloud.transcribe).toHaveBeenCalledWith(new Uint8Array([9]), null, undefined, false, []);
    expect(cleanup.polish).not.toHaveBeenCalled();
  });

  it('server and built-in notes are never cleaned', async () => {
    const cleanup = { enabled: vi.fn(() => true), polish: vi.fn(async () => 'x') };
    const { service, requests } = setup({ cleanup });
    service.enqueue([ID], 'auto');
    await service.idle();
    expect(requests[0]).not.toHaveProperty('clean');
    expect(cleanup.polish).not.toHaveBeenCalled();
  });

  it('peeks stay raw', async () => {
    const { service, deps, cloud, cleanup } = cloudSetup();
    (deps.toWav as ReturnType<typeof vi.fn>).mockResolvedValueOnce(silentWav(10));
    expect(await service.peek(ID, 4)).toBe(SAID);
    expect((cloud.transcribe.mock.calls[0] as unknown[])[3]).toBe(false);
    expect(cleanup.polish).not.toHaveBeenCalled();
  });

  it("a cleanup that never answers is given up after 30 s, and the note keeps Scribe's text", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const { service, deps } = cloudSetup({ polish: (_t, signal) => (signals.push(signal), new Promise(() => undefined)) });
      service.enqueue([ID], 'auto');
      await vi.advanceTimersByTimeAsync(CLEANUP_TIMEOUT_MS - 1);
      expect(deps.store.setTranscript).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await service.idle();
      expect(deps.store.setTranscript).toHaveBeenCalledWith(ID, SAID, 'en');
      expect(signals[0].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the server answers a long cleanup before the app gives up on it', () => {
    expect(POLISH_TIMEOUT_MS).toBeLessThan(CLEANUP_TIMEOUT_MS);
    expect(POLISH_MAX_TOKENS).toBeGreaterThanOrEqual(8000);
  });

  it('reads the setting when the job starts', async () => {
    let on = false;
    const { service, cleanup } = cloudSetup({ enabled: () => on });
    service.enqueue([ID], 'auto');
    on = true;
    await service.idle();
    expect(cleanup.polish).toHaveBeenCalled();
  });
});
