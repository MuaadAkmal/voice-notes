import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import { localDay } from '../../src/shared/sync-ops';

const T0 = new Date(2026, 9, 26, 10, 0).getTime();
let root: string;
let store: NoteStore;
const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });
const ops = () => store.sync.outbox.pending().map((e) => e.op);
const clear = () => store.sync.outbox.ack(store.sync.outbox.takeBatch(1000).map((e) => ({ id: e.mutationId, version: 1 })));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-rec-'));
  store = NoteStore.open(root, () => T0, () => 'PC-A');
  store.sync.state.setEnabled(true);
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('notes record create, update and delete', async () => {
  const n = await store.create(audio());
  expect(ops()).toEqual([{ op: 'note.create', id: n.id, row: expect.objectContaining({ id: n.id, title: n.title, durationMs: 1500 }) }]);
  expect(ops()[0]).not.toHaveProperty('row.filePath');
  clear();
  store.rename(n.id, 'Hola');
  store.setStarred([n.id], true);
  store.setShow(n.id, 'Friends');
  const f = store.folders.create('F', null);
  store.moveNotes([n.id], f.id);
  store.setTranscript(n.id, 'hola', 'es');
  expect(ops().filter((o) => o.op === 'note.update')).toEqual([
    {
      op: 'note.update',
      id: n.id,
      fields: { title: 'Hola', starred: true, show: 'Friends', folderId: f.id, transcript: 'hola', transcriptLang: 'es', transcribedAt: T0 },
    },
  ]);
  clear();
  await store.delete(n.id);
  expect(ops()).toEqual([{ op: 'note.delete', id: n.id }]);
});

it('an update is based on the version the row was last synced at', async () => {
  const n = await store.create(audio());
  clear(); // acked at version 1
  store.rename(n.id, 'x');
  expect(store.sync.outbox.pending()[0].baseVersion).toBe(1);
});

it('pages record create, title, body, append, task, move, star and delete', () => {
  const p = store.pages.create(null);
  clear();
  store.pages.rename(p.id, 'Shop');
  store.pages.setBody(p.id, '- [ ] milk\n- [ ] eggs');
  store.pages.appendEntry(p.id, 'bread');
  store.pages.setTask(p.id, 1, true);
  const f = store.folders.create('F', null);
  store.pages.move([p.id], f.id);
  store.pages.setStarred([p.id], true);
  expect(ops().filter((o) => o.op.startsWith('page.'))).toEqual([
    { op: 'page.update', id: p.id, fields: { title: 'Shop' } },
    { op: 'page.setBody', id: p.id, body: '- [ ] milk\n- [ ] eggs' },
    { op: 'page.append', id: p.id, text: 'bread', day: localDay(T0) },
    { op: 'page.setTask', id: p.id, line: 1, lineText: '- [ ] eggs', checked: true },
    { op: 'page.update', id: p.id, fields: { folderId: f.id, starred: true } },
  ]);
});

it('deleting pages records one delete each', async () => {
  const a = store.pages.create(null);
  const b = store.pages.create(null);
  clear();
  await store.pages.deleteMany([a.id, b.id]);
  expect(ops()).toEqual([
    { op: 'page.delete', id: a.id },
    { op: 'page.delete', id: b.id },
  ]);
});

it('deleting a folder records the moves of its contents, then the delete', async () => {
  const parent = store.folders.create('P', null);
  const f = store.folders.create('F', parent.id);
  const sub = store.folders.create('Sub', f.id);
  const n = await store.create(audio());
  store.moveNotes([n.id], f.id);
  const p = store.pages.create(f.id);
  clear();
  store.folders.delete(f.id);
  expect(ops()).toEqual([
    { op: 'note.update', id: n.id, fields: { folderId: parent.id } },
    { op: 'page.update', id: p.id, fields: { folderId: parent.id } },
    { op: 'folder.update', id: sub.id, fields: { parentId: parent.id, name: 'Sub' } },
    { op: 'folder.delete', id: f.id },
  ]);
});

it('folders record create, rename and move', () => {
  const a = store.folders.create('A', null);
  const b = store.folders.create('B', null);
  expect(ops()).toEqual([
    { op: 'folder.create', id: a.id, row: a },
    { op: 'folder.create', id: b.id, row: b },
  ]);
  clear();
  store.folders.rename(a.id, 'A2');
  store.folders.move(a.id, b.id);
  expect(ops()).toEqual([{ op: 'folder.update', id: a.id, fields: { name: 'A2', parentId: b.id } }]);
});

it('records nothing while sync is off', async () => {
  store.sync.state.setEnabled(false);
  const n = await store.create(audio());
  store.rename(n.id, 'x');
  const p = store.pages.create(null);
  store.pages.appendEntry(p.id, 'x');
  store.folders.create('F', null);
  expect(ops()).toEqual([]);
});

it('a failed change leaves no outbox entry', () => {
  expect(() => store.pages.setBody('nope', 'x')).toThrow('Page not found');
  expect(() => store.pages.setTask(store.pages.create(null).id, 0, true)).toThrow('Not a task');
  expect(ops().map((o) => o.op)).toEqual(['page.create']);
});
