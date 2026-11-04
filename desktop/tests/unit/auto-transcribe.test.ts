import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { AutoTranscribe, isDefaultTitle } from '../../src/main/transcription/auto';
import type { Folder, Note, Settings } from '../../src/shared/channels';
import { defaultTitle } from '../../src/shared/format';

const CREATED = Date.parse('2026-11-04T09:00:00Z');
const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: defaultTitle(new Date(CREATED)),
  filePath: 'recordings/n1.webm',
  durationMs: 1000,
  sizeBytes: 1,
  mimeType: 'audio/webm',
  status: 'ok',
  createdAt: CREATED,
  updatedAt: CREATED,
  syncedAt: null,
  folderId: null,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  transcript: 'buy milk and eggs for the weekend',
  transcriptLang: 'en',
  transcribedAt: CREATED,
  ...over,
});
const MOVIES: Folder = { id: 'f1', name: 'Movie lines', parentId: null, createdAt: 0, updatedAt: 0 };

function setup(o: { settings?: Partial<Settings>; notes?: Note[]; paused?: boolean; title?: () => Promise<{ title: string | null }> } = {}) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    transcription: { ...DEFAULT_SETTINGS.transcription, provider: 'cloud' },
    ...o.settings,
  };
  const notes = new Map((o.notes ?? [note()]).map((n) => [n.id, n]));
  const d = {
    settings: () => settings,
    store: {
      get: vi.fn((id: string) => notes.get(id) ?? null),
      rename: vi.fn((id: string, title: string) => {
        const n = { ...notes.get(id)!, title };
        notes.set(id, n);
        return n;
      }),
      moveNotes: vi.fn(),
      folders: { list: () => [MOVIES] },
    },
    enqueue: vi.fn(),
    paused: () => o.paused ?? false,
    title: vi.fn(o.title ?? (async () => ({ title: 'Weekend groceries' }))),
    peekFolder: vi.fn(async () => undefined),
    onFiled: vi.fn(),
    notesChanged: vi.fn(),
  };
  return { auto: new AutoTranscribe(d), d, notes };
}

it('queues a new mic note and a new rewind', () => {
  const { auto, d } = setup();
  auto.saved(note());
  auto.saved(note({ id: 'r1', kind: 'rewind', source: 'system' }));
  expect(d.enqueue.mock.calls).toEqual([
    [['n1'], 'auto'],
    [['r1'], 'auto'],
  ]);
});

it('queues nothing when switched off, not set up, or out of Cloud minutes', () => {
  for (const s of [setup({ settings: { autoTranscribe: false } }), setup({ settings: { transcription: DEFAULT_SETTINGS.transcription } }), setup({ paused: true })]) {
    s.auto.saved(note());
    expect(s.d.enqueue).not.toHaveBeenCalled();
  }
});

it('files by voice with its own short peek only when auto is off', () => {
  const off = setup({ settings: { autoTranscribe: false } });
  off.auto.saved(note());
  expect(off.d.peekFolder).toHaveBeenCalled();
  const on = setup();
  on.auto.saved(note());
  expect(on.d.peekFolder).not.toHaveBeenCalled();
});

it('files a new note by the start of its full transcript', async () => {
  const n = note({ transcript: 'Pixie movie lines, I am your father' });
  const { auto, d } = setup({ notes: [n] });
  auto.saved(n);
  await auto.transcribed('n1');
  expect(d.store.moveNotes).toHaveBeenCalledWith(['n1'], 'f1');
  expect(d.onFiled).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), MOVIES);
});

it('does not file an old note that was transcribed by hand', async () => {
  const { auto, d } = setup({ notes: [note({ transcript: 'Pixie movie lines, hello' })] });
  await auto.transcribed('n1');
  expect(d.store.moveNotes).not.toHaveBeenCalled();
});

it('titles a note still on its default title from the first 2000 characters', async () => {
  const long = `buy milk ${'x'.repeat(3000)}`;
  const { auto, d, notes } = setup({ notes: [note({ transcript: long })] });
  await auto.transcribed('n1');
  expect(d.title).toHaveBeenCalledWith(long.slice(0, 2000));
  expect(notes.get('n1')!.title).toBe('Weekend groceries');
  expect(d.notesChanged).toHaveBeenCalled();
});

it('keeps a title the user typed while the title was being written', async () => {
  let notes!: Map<string, Note>;
  const s = setup({
    title: async () => {
      notes.set('n1', { ...notes.get('n1')!, title: 'My own' });
      return { title: 'Weekend groceries' };
    },
  });
  notes = s.notes;
  await s.auto.transcribed('n1');
  expect(s.d.store.rename).not.toHaveBeenCalled();
  expect(notes.get('n1')!.title).toBe('My own');
});

it.each([
  ['a title the user gave', { title: 'Mine' }],
  ['no speech', { transcript: '' }],
  ['two words', { transcript: 'buy milk' }],
])('does not ask for a title with %s', async (_, over) => {
  const { auto, d } = setup({ notes: [note(over)] });
  await auto.transcribed('n1');
  expect(d.title).not.toHaveBeenCalled();
});

it('does not ask when titles are switched off', async () => {
  const { auto, d } = setup({ settings: { autoTitle: false } });
  await auto.transcribed('n1');
  expect(d.title).not.toHaveBeenCalled();
});

it.each([
  ['refused', async () => { throw new Error('offline'); }],
  ['null', async () => ({ title: null })],
])('keeps the title when the answer is %s', async (_, title) => {
  const { auto, d } = setup({ title });
  await expect(auto.transcribed('n1')).resolves.toBeUndefined();
  expect(d.store.rename).not.toHaveBeenCalled();
});

it('does nothing for a note deleted before the answer', async () => {
  let notes!: Map<string, Note>;
  const s = setup({ title: async () => (notes.delete('n1'), { title: 'Late' }) });
  notes = s.notes;
  await s.auto.transcribed('n1');
  expect(s.d.store.rename).not.toHaveBeenCalled();
});

it('knows a default title', () => {
  expect(isDefaultTitle(note())).toBe(true);
  expect(isDefaultTitle(note({ title: 'Mine' }))).toBe(false);
});
