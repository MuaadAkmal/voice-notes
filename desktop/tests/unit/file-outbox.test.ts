import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Settings } from '../../src/shared/channels';
import { NoteStore } from '../../src/main/store/note-store';
import { SyncEngine } from '../../src/main/sync/engine';

let root: string;
let clock: number;
let store: NoteStore;
const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });
const png = new Uint8Array([137, 80, 78, 71]);
const names = () => store.sync.files.due().map((e) => `${e.kind}:${e.name}`);
const settings = { homeWidgets: [], transcribeLanguage: null, laterPageId: null } as unknown as Settings;
const engine = () =>
  new SyncEngine(store, { push: async () => ({ acked: [] }), pull: async () => ({ cursor: 0, hasMore: false, rows: [], prefs: [] }) }, {
    get: () => settings,
    update: () => settings,
    applyRemote: () => undefined,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-files-'));
  clock = 1000;
  store = NoteStore.open(root, () => clock, () => 'PC-A');
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('a new note queues its audio in the same transaction, only while sync is on', async () => {
  await store.create(audio());
  expect(names()).toEqual([]);
  store.sync.state.setEnabled(true);
  const note = await store.create(audio());
  expect(names()).toEqual([`audio:${note.id}.webm`]);
});

it('saveImage queues the image while sync is on', async () => {
  await store.pages.saveImage(png, 'png');
  expect(names()).toEqual([]);
  store.sync.state.setEnabled(true);
  const url = await store.pages.saveImage(png, 'png');
  expect(names()).toEqual([`image:${url.slice('vn-image://'.length)}`]);
});

it('deleting a note drops its queued audio', async () => {
  store.sync.state.setEnabled(true);
  const a = await store.create(audio());
  const b = await store.create(audio());
  await store.delete(a.id);
  expect(names()).toEqual([`audio:${b.id}.webm`]);
});

it('enable queues never-synced ok notes and images of never-synced pages, not remote notes or synced rows', async () => {
  const fresh = await store.create(audio());
  const synced = await store.create(audio());
  const remote = await store.create(audio());
  store.sync.outbox.setRowVersion('note', synced.id, 3);
  const raw = store.syncAccess().sqlite;
  raw.prepare("UPDATE notes SET status = 'remote' WHERE id = ?").run(remote.id);
  const img = (await store.pages.saveImage(png, 'png')).slice('vn-image://'.length);
  const gone = 'ffffffff-ffff-4fff-8fff-ffffffffffff.png'; // referenced, but no file here
  const page = store.pages.create(null);
  store.pages.setBody(page.id, `![](vn-image://${img}) ![](vn-image://${gone})`);
  engine().enable(settings);
  expect(names().sort()).toEqual([`audio:${fresh.id}.webm`, `image:${img}`].sort());
});

it('startFresh clears the queue and requeues only version-0 files', async () => {
  store.sync.state.setEnabled(true);
  const a = await store.create(audio());
  const b = await store.create(audio());
  store.sync.outbox.setRowVersion('note', a.id, 5); // synced to the old account
  engine().startFresh(settings);
  expect(names()).toEqual([`audio:${b.id}.webm`]);
});

it('due skips entries scheduled later; later() bumps attempts', async () => {
  store.sync.state.setEnabled(true);
  const a = await store.create(audio());
  const files = store.sync.files;
  files.later('audio', `${a.id}.webm`, clock + 60_000);
  expect(files.due()).toEqual([]);
  expect(files.count()).toBe(1);
  clock += 60_000;
  expect(files.due()).toEqual([{ kind: 'audio', name: `${a.id}.webm`, attempts: 1, nextAt: clock, createdAt: 1000 }]);
  files.clear();
  expect(files.count()).toBe(0);
});

it('a PC that turned sync on before files synced queues all its files once', async () => {
  const synced = await store.create(audio());
  const fresh = await store.create(audio());
  const remote = await store.create(audio());
  store.sync.outbox.setRowVersion('note', synced.id, 7);
  store.syncAccess().sqlite.prepare("UPDATE notes SET status = 'remote' WHERE id = ?").run(remote.id);
  const img = (await store.pages.saveImage(png, 'png')).slice('vn-image://'.length);
  const page = store.pages.create(null);
  store.pages.setBody(page.id, `![](vn-image://${img})`);
  store.sync.state.setEnabled(true); // turned on by an earlier version, which had no file queue
  engine().queueExistingFiles();
  expect(names().sort()).toEqual([`audio:${synced.id}.webm`, `audio:${fresh.id}.webm`, `image:${img}`].sort());
  store.sync.files.clear();
  engine().queueExistingFiles();
  expect(names()).toEqual([]);
});

it('the catch-up does nothing while sync is off, or after enable already queued the files', async () => {
  await store.create(audio());
  engine().queueExistingFiles();
  expect(names()).toEqual([]);
  engine().enable(settings);
  store.sync.files.clear();
  engine().queueExistingFiles();
  expect(names()).toEqual([]);
});
