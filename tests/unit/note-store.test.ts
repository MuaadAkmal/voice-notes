import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';

const T0 = new Date(2026, 9, 24, 14, 32).getTime();
let root: string;
let clock: number;
let store: NoteStore;
const audio = (s = 'abc', durationMs = 1500) => ({
  bytes: Buffer.from(s),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
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
