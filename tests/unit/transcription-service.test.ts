import { expect, it, vi } from 'vitest';
import type { Note, Settings } from '../../src/shared/channels';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import {
  type TranscribeRequest,
  TranscriptionFailed,
} from '../../src/main/transcription/openai-client';
import {
  type ServiceDeps,
  TranscriptionService,
} from '../../src/main/transcription/service';
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
  const deps: ServiceDeps = {
    store: {
      get: vi.fn(() => note()),
      absolutePath: (n: Note) => `C:/data/${n.filePath}`,
      setTranscript: vi.fn((id: string, text: string, lang: string | null) =>
        note({ id, transcript: text, transcriptLang: lang }),
      ),
    },
    getSettings: () => settings,
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
