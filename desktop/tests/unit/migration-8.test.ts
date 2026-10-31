import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MIGRATIONS } from '../../src/main/store/migrations';
import { NoteStore } from '../../src/main/store/note-store';

const DAY = 86_400_000;
const T0 = new Date(2026, 9, 26, 10, 0).getTime();
let root: string;
let clock: number;
let store: NoteStore;
const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });
const raw = () => new Database(path.join(root, 'voice-notes.sqlite'));
const rawRow = (table: string, id: string) => {
  const db = raw();
  try {
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-m8-'));
  clock = T0;
});
afterEach(() => {
  store?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('upgrades a v7 database without touching its data', () => {
  const db = new Database(path.join(root, 'voice-notes.sqlite'));
  MIGRATIONS.slice(0, 7).forEach((sql) => db.exec(sql));
  db.pragma('user_version = 7');
  db.prepare(
    "INSERT INTO notes (id, title, file_path, duration_ms, size_bytes, mime_type, status, created_at, updated_at) VALUES ('n', 't', 'recordings/n.webm', 1, 1, 'audio/webm', 'ok', 1, 1)",
  ).run();
  db.prepare("INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f', 'F', 1, 1)").run();
  db.prepare("INSERT INTO pages (id, title, created_at, updated_at) VALUES ('p', 'P', 1, 1)").run();
  db.close();
  store = NoteStore.open(root, () => clock);
  for (const [table, id] of [['notes', 'n'], ['folders', 'f'], ['pages', 'p']]) {
    expect(rawRow(table, id)).toMatchObject({ version: 0, deleted_at: null });
  }
  const check = raw();
  const tables = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name);
  check.close();
  expect(tables).toEqual(expect.arrayContaining(['outbox', 'sync_state']));
  expect(store.get('n')?.title).toBe('t');
});

it('a deleted note is hidden but kept as a tombstone, and its audio is gone', async () => {
  store = NoteStore.open(root, () => clock);
  const n = await store.create(audio());
  await store.delete(n.id);
  expect(store.get(n.id)).toBeUndefined();
  expect(store.list()).toEqual([]);
  expect(fs.existsSync(path.join(root, n.filePath))).toBe(false);
  expect(rawRow('notes', n.id)).toMatchObject({ deleted_at: T0 });
  expect(Object.keys(store.list()[0] ?? n)).not.toContain('deletedAt');
});

it('shared types never carry sync columns', async () => {
  store = NoteStore.open(root, () => clock);
  const n = await store.create(audio());
  expect(store.get(n.id)).not.toHaveProperty('version');
  expect(store.get(n.id)).not.toHaveProperty('deletedAt');
  const p = store.pages.create(null);
  expect(store.pages.get(p.id)).not.toHaveProperty('version');
  const f = store.folders.create('A', null);
  expect(store.folders.get(f.id)).not.toHaveProperty('deletedAt');
});

it('reconcile never adopts a deleted note\'s file, and removes it', async () => {
  store = NoteStore.open(root, () => clock);
  const n = await store.create(audio());
  await store.delete(n.id);
  const file = path.join(store.recordingsDir, `${n.id}.webm`);
  fs.writeFileSync(file, 'back'); // left behind when Windows held it open during the delete
  expect(await store.reconcile()).toEqual({ missing: 0, adopted: 0, tmpRemoved: 0 });
  expect(store.get(n.id)).toBeUndefined();
  expect(fs.existsSync(file)).toBe(false);
});

it('deleted pages are hidden, kept as tombstones, and lose their unused images', async () => {
  store = NoteStore.open(root, () => clock);
  const url = await store.pages.saveImage(new Uint8Array([1, 2]), 'png');
  const p = store.pages.create(null);
  store.pages.setBody(p.id, `![](${url})`);
  await store.pages.deleteMany([p.id]);
  expect(store.pages.get(p.id)).toBeUndefined();
  expect(store.pages.list()).toEqual([]);
  expect(rawRow('pages', p.id)).toMatchObject({ deleted_at: T0 });
  expect(fs.readdirSync(store.imagesDir)).toEqual([]);
});

it('a deleted folder is hidden, frees its name, and cannot be moved into', async () => {
  store = NoteStore.open(root, () => clock);
  const f = store.folders.create('Work', null);
  store.folders.delete(f.id);
  expect(store.folders.get(f.id)).toBeUndefined();
  expect(store.folders.list()).toEqual([]);
  expect(() => store.folders.create('Work', null)).not.toThrow();
  const n = await store.create(audio());
  expect(() => store.moveNotes([n.id], f.id)).toThrow('Folder not found');
  expect(() => store.pages.create(f.id)).toThrow('Folder not found');
});

it('purges tombstones after 30 days unless a change is still waiting to sync', async () => {
  store = NoteStore.open(root, () => clock);
  const old = await store.create(audio());
  const recent = await store.create(audio());
  const waiting = await store.create(audio());
  await store.delete(old.id);
  await store.delete(waiting.id);
  clock = T0 + 2 * DAY;
  await store.delete(recent.id);
  const db = raw();
  db.prepare("INSERT INTO outbox (mutation_id, op, entity_id, payload, base_version, created_at) VALUES (?, 'note.delete', ?, '{}', 0, 0)").run(randomUUID(), waiting.id);
  db.close();
  expect(store.purgeTombstones(T0 + 31 * DAY)).toBe(1);
  expect(rawRow('notes', old.id)).toBeUndefined();
  expect(rawRow('notes', recent.id)).toBeDefined();
  expect(rawRow('notes', waiting.id)).toBeDefined();
});
