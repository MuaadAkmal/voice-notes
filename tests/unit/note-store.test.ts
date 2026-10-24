import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { NoteStore } from '../../src/main/store/note-store';
import { MIGRATIONS } from '../../src/main/store/migrations';

const T0 = new Date(2026, 9, 24, 14, 32).getTime();
let root: string;
let clock: number;
let store: NoteStore;
const audio = (s = 'abc', durationMs = 1500) => ({
  bytes: Buffer.from(s),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
  source: 'mic' as const,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-store-'));
  clock = T0;
  store = NoteStore.open(root, () => clock);
});
afterEach(() => store.close());

it('create writes file and row', async () => {
  const note = await store.create(audio());
  expect(note.filePath).toBe(`recordings/${note.id}.webm`);
  expect(fs.readFileSync(path.join(root, note.filePath), 'utf8')).toBe('abc');
  expect(note).toMatchObject({
    sizeBytes: 3,
    durationMs: 1500,
    status: 'ok',
    title: 'Voice note · 14:32',
    createdAt: T0,
    updatedAt: T0,
    syncedAt: null,
  });
  expect(store.get(note.id)).toEqual(note);
});

it('create leaves no .tmp file', async () => {
  await store.create(audio());
  expect(fs.readdirSync(store.recordingsDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});

it('list returns newest first', async () => {
  const a = await store.create(audio());
  clock += 1000;
  const b = await store.create(audio());
  expect(store.list().map((n) => n.id)).toEqual([b.id, a.id]);
});

it('rename updates title and updatedAt', async () => {
  const n = await store.create(audio());
  clock += 5000;
  const r = store.rename(n.id, 'gracias');
  expect(r.title).toBe('gracias');
  expect(r.updatedAt).toBe(T0 + 5000);
  expect(store.get(n.id)?.title).toBe('gracias');
});

it('rename unknown id throws', () => {
  expect(() => store.rename(randomUUID(), 'x')).toThrow('Note not found');
});

it('delete removes file and row', async () => {
  const n = await store.create(audio());
  await store.delete(n.id);
  expect(store.list()).toEqual([]);
  expect(fs.existsSync(store.absolutePath(n))).toBe(false);
});

it('delete tolerates missing file', async () => {
  const n = await store.create(audio());
  fs.unlinkSync(store.absolutePath(n));
  await expect(store.delete(n.id)).resolves.toBeUndefined();
  expect(store.list()).toEqual([]);
});

it('reconcile marks missing rows', async () => {
  const n = await store.create(audio());
  fs.unlinkSync(store.absolutePath(n));
  expect(await store.reconcile()).toEqual({ missing: 1, adopted: 0, tmpRemoved: 0 });
  expect(store.get(n.id)?.status).toBe('missing');
});

it('reconcile adopts orphan files', async () => {
  const id = randomUUID();
  const file = path.join(store.recordingsDir, `${id}.webm`);
  fs.writeFileSync(file, 'orphan');
  const mtime = new Date(2026, 9, 20, 8, 15);
  fs.utimesSync(file, mtime, mtime);
  fs.writeFileSync(path.join(store.recordingsDir, 'not-a-uuid.webm'), 'x');
  expect(await store.reconcile()).toEqual({ missing: 0, adopted: 1, tmpRemoved: 0 });
  expect(store.get(id)).toMatchObject({ durationMs: 0, sizeBytes: 6, createdAt: mtime.getTime(), status: 'ok' });
});

it('reconcile removes stale tmp files', async () => {
  const tmp = path.join(store.recordingsDir, 'x.webm.tmp');
  fs.writeFileSync(tmp, 'partial');
  expect(await store.reconcile()).toEqual({ missing: 0, adopted: 0, tmpRemoved: 1 });
  expect(fs.existsSync(tmp)).toBe(false);
});

it('reopen keeps data and does not re-run migrations', async () => {
  await store.create(audio());
  store.close();
  store = NoteStore.open(root, () => clock);
  expect(store.list()).toHaveLength(1);
});

it('new notes start in Inbox', async () => {
  expect((await store.create(audio())).folderId).toBeNull();
});

it('moveNotes into a folder and back to Inbox', async () => {
  const n = await store.create(audio());
  const f = store.folders.create('Spanish', null);
  clock += 10;
  store.moveNotes([n.id], f.id);
  expect(store.get(n.id)).toMatchObject({ folderId: f.id, updatedAt: T0 + 10 });
  store.moveNotes([n.id], null);
  expect(store.get(n.id)?.folderId).toBeNull();
});

it('moveNotes to an unknown folder throws', async () => {
  const n = await store.create(audio());
  expect(() => store.moveNotes([n.id], randomUUID())).toThrow('Folder not found');
});

it('moveNotes ignores unknown note ids', async () => {
  const n = await store.create(audio());
  const f = store.folders.create('Spanish', null);
  expect(() => store.moveNotes([randomUUID(), n.id], f.id)).not.toThrow();
  expect(store.get(n.id)?.folderId).toBe(f.id);
});

it('deleteMany removes files and rows', async () => {
  const a = await store.create(audio());
  const b = await store.create(audio());
  const keep = await store.create(audio());
  await store.deleteMany([a.id, b.id]);
  expect(store.list().map((n) => n.id)).toEqual([keep.id]);
  expect(fs.existsSync(store.absolutePath(a))).toBe(false);
  expect(fs.existsSync(store.absolutePath(b))).toBe(false);
});

it('migrates a v1 database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-v1-'));
  fs.mkdirSync(path.join(dir, 'recordings'));
  const db = new Database(path.join(dir, 'voice-notes.sqlite'));
  db.exec(MIGRATIONS[0]);
  db.pragma('user_version = 1');
  const id = randomUUID();
  fs.writeFileSync(path.join(dir, 'recordings', `${id}.webm`), 'x');
  db.prepare(
    `INSERT INTO notes VALUES (?, 'old', ?, 1000, 1, 'audio/webm;codecs=opus', 'ok', 1, 1, NULL)`,
  ).run(id, `recordings/${id}.webm`);
  db.close();
  const upgraded = NoteStore.open(dir);
  expect(upgraded.list()).toEqual([expect.objectContaining({ id, title: 'old', folderId: null })]);
  expect(upgraded.folders.list()).toEqual([]);
  upgraded.close();
});

it('create stores the recording source', async () => {
  const n = await store.create({ ...audio(), source: 'system' });
  expect(n.source).toBe('system');
  expect(store.get(n.id)?.source).toBe('system');
});

it('migrates a v2 database: existing notes get source mic', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-v2-'));
  fs.mkdirSync(path.join(dir, 'recordings'));
  const db = new Database(path.join(dir, 'voice-notes.sqlite'));
  db.exec(MIGRATIONS[0]);
  db.exec(MIGRATIONS[1]);
  db.pragma('user_version = 2');
  const id = randomUUID();
  fs.writeFileSync(path.join(dir, 'recordings', `${id}.webm`), 'x');
  db.prepare(
    `INSERT INTO notes VALUES (?, 'old', ?, 1000, 1, 'audio/webm;codecs=opus', 'ok', 1, 1, NULL, NULL)`,
  ).run(id, `recordings/${id}.webm`);
  db.close();
  const upgraded = NoteStore.open(dir);
  expect(upgraded.get(id)?.source).toBe('mic');
  upgraded.close();
});