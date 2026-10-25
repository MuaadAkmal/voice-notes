import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { NoteStore } from '../../src/main/store/note-store';
import { MIGRATIONS } from '../../src/main/store/migrations';
import { MAX_IMAGE_BYTES } from '../../src/shared/page-images';

const T0 = new Date(2026, 9, 24, 14, 32).getTime();
let root: string;
let clock: number;
let store: NoteStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-pages-'));
  clock = T0;
  store = NoteStore.open(root, () => clock);
});
afterEach(() => store.close());

it('create puts an Untitled empty page in the folder', () => {
  const page = store.pages.create(null);
  expect(page).toMatchObject({
    title: 'Untitled',
    body: '',
    folderId: null,
    starred: false,
    createdAt: T0,
    updatedAt: T0,
  });
  expect('syncedAt' in store.pages.get(page.id)!).toBe(false);
  const folder = store.folders.create('Ideas', null);
  expect(store.pages.create(folder.id).folderId).toBe(folder.id);
  expect(() => store.pages.create(randomUUID())).toThrow('Folder not found');
});

it('setBody and rename bump updatedAt and list orders by it', () => {
  const a = store.pages.create(null);
  clock = T0 + 1;
  const b = store.pages.create(null);
  clock = T0 + 2;
  store.pages.setBody(a.id, '# hi');
  expect(store.pages.list().map((p) => p.id)).toEqual([a.id, b.id]);
  expect(store.pages.get(a.id)?.body).toBe('# hi');
  clock = T0 + 3;
  expect(store.pages.rename(b.id, 'Beta').updatedAt).toBe(T0 + 3);
  expect(store.pages.list().map((p) => p.id)).toEqual([b.id, a.id]);
  expect(() => store.pages.rename(randomUUID(), 'x')).toThrow('Page not found');
  expect(() => store.pages.setBody(randomUUID(), 'x')).toThrow('Page not found');
});

it('move and setStarred ignore unknown ids', () => {
  const a = store.pages.create(null);
  const folder = store.folders.create('Ideas', null);
  store.pages.move([a.id, randomUUID()], folder.id);
  expect(store.pages.get(a.id)?.folderId).toBe(folder.id);
  expect(() => store.pages.move([a.id], randomUUID())).toThrow('Folder not found');
  store.pages.setStarred([a.id, randomUUID()], true);
  expect(store.pages.get(a.id)?.starred).toBe(true);
});

it('saveImage writes the file and returns a vn-image url', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const url = await store.pages.saveImage(bytes, 'png');
  expect(url).toMatch(/^vn-image:\/\/[0-9a-f-]{36}\.png$/);
  const file = url.slice('vn-image://'.length);
  expect(fs.readFileSync(path.join(store.imagesDir, file))).toEqual(Buffer.from(bytes));
  expect(store.pages.imagePath(file)).toBe(path.join(store.imagesDir, file));
  await expect(store.pages.saveImage(new Uint8Array(MAX_IMAGE_BYTES + 1), 'png')).rejects.toThrow(
    'Image too large',
  );
});

it('deleteMany keeps images still referenced by another page', async () => {
  const url = await store.pages.saveImage(new Uint8Array([1]), 'png');
  const url2 = await store.pages.saveImage(new Uint8Array([2]), 'jpg');
  const a = store.pages.create(null);
  const b = store.pages.create(null);
  const c = store.pages.create(null);
  store.pages.setBody(a.id, `![](${url})`);
  store.pages.setBody(b.id, `text ![](${url})`);
  store.pages.setBody(c.id, `![](${url2})`);
  await store.pages.deleteMany([a.id, c.id]);
  const file = (u: string) => path.join(store.imagesDir, u.slice('vn-image://'.length));
  expect(fs.existsSync(file(url))).toBe(true);
  expect(fs.existsSync(file(url2))).toBe(false);
  expect(store.pages.list().map((p) => p.id)).toEqual([b.id]);
});

it('migration 5 upgrades a v4 database', async () => {
  store.close();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-mig-'));
  const raw = new Database(path.join(dir, 'voice-notes.sqlite'));
  for (const sql of MIGRATIONS.slice(0, 4)) raw.exec(sql);
  raw.pragma('user_version = 4');
  raw
    .prepare(
      `INSERT INTO notes (id, title, file_path, duration_ms, size_bytes, mime_type, status, created_at, updated_at)
       VALUES (?, 'Old', 'recordings/x.webm', 1, 1, 'audio/webm', 'ok', 1, 1)`,
    )
    .run(randomUUID());
  raw.close();
  store = NoteStore.open(dir, () => clock);
  const check = new Database(path.join(dir, 'voice-notes.sqlite'));
  expect(check.pragma('user_version', { simple: true })).toBe(5);
  check.close();
  expect(store.list()).toHaveLength(1);
  expect(store.pages.list()).toEqual([]);
});
