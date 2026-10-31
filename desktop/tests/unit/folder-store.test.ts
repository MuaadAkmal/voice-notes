import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import type { FolderStore } from '../../src/main/store/folder-store';

let store: NoteStore;
let folders: FolderStore;
const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });
const place = (noteId: string, folderId: string | null) => store.moveNotes([noteId], folderId);
const names = () => folders.list().map((f) => f.name).sort();

beforeEach(() => {
  store = NoteStore.open(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-folders-')), () => 1000);
  folders = store.folders;
});
afterEach(() => store.close());

it('creates top-level and nested folders', () => {
  const spanish = folders.create('Spanish', null);
  const films = folders.create('Films', spanish.id);
  expect(spanish).toMatchObject({ name: 'Spanish', parentId: null, createdAt: 1000, updatedAt: 1000 });
  expect(films.parentId).toBe(spanish.id);
  expect(folders.list()).toHaveLength(2);
});

it('rejects invalid names', () => {
  for (const bad of ['', '   ', 'a/b', 'a\\b', 'x'.repeat(101)]) {
    expect(() => folders.create(bad, null)).toThrow('Folder name is invalid');
  }
});

it('trims names', () => {
  expect(folders.create('  Spanish ', null).name).toBe('Spanish');
});

it('rejects duplicate sibling names case-insensitively', () => {
  folders.create('Spanish', null);
  expect(() => folders.create('spanish', null)).toThrow('A folder named "spanish" already exists here');
});

it('allows the same name under different parents', () => {
  const a = folders.create('Spanish', null);
  const b = folders.create('Japanese', null);
  folders.create('Films', a.id);
  expect(() => folders.create('Films', b.id)).not.toThrow();
});

it('rename checks duplicates but not against itself', () => {
  const a = folders.create('Spanish', null);
  folders.create('Japanese', null);
  expect(folders.rename(a.id, 'SPANISH').name).toBe('SPANISH');
  expect(() => folders.rename(a.id, 'japanese')).toThrow('A folder named "japanese" already exists here');
});

it('moves to top level and into another folder', () => {
  const a = folders.create('Spanish', null);
  const b = folders.create('Films', null);
  expect(folders.move(b.id, a.id).parentId).toBe(a.id);
  expect(folders.move(b.id, null).parentId).toBeNull();
});

it('move into self or descendant throws', () => {
  const a = folders.create('Spanish', null);
  const b = folders.create('Films', a.id);
  expect(() => folders.move(a.id, a.id)).toThrow("Can't move a folder into itself");
  expect(() => folders.move(a.id, b.id)).toThrow("Can't move a folder into itself");
});

it('move checks duplicate names at the destination', () => {
  const a = folders.create('Spanish', null);
  folders.create('Films', a.id);
  const top = folders.create('Films', null);
  expect(() => folders.move(top.id, a.id)).toThrow('A folder named "Films" already exists here');
});

it('move/rename/delete unknown id throws Folder not found', () => {
  const id = randomUUID();
  expect(() => folders.move(id, null)).toThrow('Folder not found');
  expect(() => folders.rename(id, 'x')).toThrow('Folder not found');
  expect(() => folders.delete(id)).toThrow('Folder not found');
  expect(() => folders.create('x', id)).toThrow('Folder not found');
});

it('delete moves notes and children up', async () => {
  const spanish = folders.create('Spanish', null);
  const films = folders.create('Films', spanish.id);
  const note = await store.create(audio());
  place(note.id, spanish.id);
  folders.delete(spanish.id);
  expect(store.get(note.id)?.folderId).toBeNull();
  expect(folders.get(films.id)?.parentId).toBeNull();
  expect(folders.get(spanish.id)).toBeUndefined();
});

it('delete renames colliding children', () => {
  folders.create('Films', null);
  const spanish = folders.create('Spanish', null);
  folders.create('Films', spanish.id);
  folders.delete(spanish.id);
  expect(names()).toEqual(['Films', 'Films (2)']);
});

it("delete moves the folder's pages to its parent", () => {
  const spanish = folders.create('Spanish', null);
  const films = folders.create('Films', spanish.id);
  const page = store.pages.create(films.id);
  folders.delete(films.id);
  expect(store.pages.get(page.id)?.folderId).toBe(spanish.id);
});

it('delete of a nested folder moves notes to its parent', async () => {
  const spanish = folders.create('Spanish', null);
  const films = folders.create('Films', spanish.id);
  const note = await store.create(audio());
  place(note.id, films.id);
  folders.delete(films.id);
  expect(store.get(note.id)?.folderId).toBe(spanish.id);
});
