import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';
import { Outbox } from '../../src/main/sync/outbox';
import { SyncState } from '../../src/main/sync/state';

let root: string;
let store: NoteStore;
let state: SyncState;
let outbox: Outbox;
let n = 0;
const sqlite = () => (store as unknown as { sqlite: import('better-sqlite3').Database }).sqlite;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-outbox-'));
  store = NoteStore.open(root, () => 1000);
  state = new SyncState(sqlite(), () => 'PC-A');
  outbox = new Outbox(sqlite(), state, () => 1000, () => `m${++n}`);
  state.setEnabled(true);
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('keeps one device id and name per database', () => {
  const id = state.deviceId();
  expect(id).toMatch(/[0-9a-f-]{36}/);
  expect(new SyncState(sqlite(), () => 'OTHER').deviceId()).toBe(id);
  expect(state.deviceName()).toBe('PC-A');
  expect(state.cursor()).toBe(0);
  state.setCursor(42);
  expect(new SyncState(sqlite(), () => 'x').cursor()).toBe(42);
});

it('records nothing while sync is off', () => {
  state.setEnabled(false);
  outbox.record({ op: 'note.delete', id: 'a' }, 0);
  expect(outbox.pending()).toEqual([]);
});

it('typing leaves one pending body: the last text, based on the first version', () => {
  outbox.record({ op: 'page.setBody', id: 'p', body: 'a' }, 3);
  outbox.record({ op: 'page.setBody', id: 'p', body: 'ab' }, 4);
  outbox.record({ op: 'page.setBody', id: 'p', body: 'abc' }, 4);
  const p = outbox.pending('p');
  expect(p).toHaveLength(1);
  expect(p[0]).toMatchObject({ op: { body: 'abc' }, baseVersion: 3 });
});

it('updates to the same row merge their fields', () => {
  outbox.record({ op: 'note.update', id: 'a', fields: { title: 'x' } }, 0);
  outbox.record({ op: 'note.update', id: 'a', fields: { starred: true } }, 0);
  expect(outbox.pending('a').map((e) => e.op)).toEqual([{ op: 'note.update', id: 'a', fields: { title: 'x', starred: true } }]);
});

it('never merges into a change already being sent', () => {
  outbox.record({ op: 'page.setBody', id: 'p', body: 'a' }, 0);
  outbox.takeBatch();
  outbox.record({ op: 'page.setBody', id: 'p', body: 'ab' }, 0);
  expect(outbox.pending('p')).toHaveLength(2);
});

it('only merges into the latest change for that row', () => {
  outbox.record({ op: 'page.setBody', id: 'p', body: 'a' }, 0);
  outbox.record({ op: 'page.append', id: 'p', text: 'x', day: '2026-10-26' }, 0);
  outbox.record({ op: 'page.setBody', id: 'p', body: 'b' }, 0);
  expect(outbox.pending('p').map((e) => e.op.op)).toEqual(['page.setBody', 'page.append', 'page.setBody']);
});

it('appends never merge; a pref replaces the pending one for its key', () => {
  outbox.record({ op: 'page.append', id: 'p', text: 'x', day: '2026-10-26' }, 0);
  outbox.record({ op: 'page.append', id: 'p', text: 'y', day: '2026-10-26' }, 0);
  expect(outbox.pending('p')).toHaveLength(2);
  outbox.record({ op: 'prefs.set', key: 'transcribeLanguage', value: 'es' }, 0);
  outbox.record({ op: 'prefs.set', key: 'transcribeLanguage', value: 'fr' }, 0);
  expect(outbox.pending('transcribeLanguage').map((e) => e.op)).toEqual([{ op: 'prefs.set', key: 'transcribeLanguage', value: 'fr' }]);
});

it('a delete drops the pending changes; with its create unsent, nothing is sent at all', () => {
  const row = { id: 'n', title: 't', body: '', folderId: null, starred: false, createdAt: 1, updatedAt: 1 };
  outbox.record({ op: 'page.create', id: 'n', row }, 0);
  outbox.record({ op: 'page.setBody', id: 'n', body: 'x' }, 0);
  outbox.record({ op: 'page.delete', id: 'n' }, 0);
  expect(outbox.pending('n')).toEqual([]);

  outbox.record({ op: 'note.update', id: 'm', fields: { title: 'x' } }, 2);
  outbox.record({ op: 'note.delete', id: 'm' }, 2);
  expect(outbox.pending('m').map((e) => e.op.op)).toEqual(['note.delete']);
});

it('a create already being sent still gets its delete', () => {
  const row = { id: 'n', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 };
  outbox.record({ op: 'folder.create', id: 'n', row }, 0);
  outbox.takeBatch();
  outbox.record({ op: 'folder.delete', id: 'n' }, 0);
  expect(outbox.pending('n').map((e) => e.op.op)).toEqual(['folder.create', 'folder.delete']);
});

it('ack removes the sent changes and records the row version; release lets a failed batch go again', async () => {
  const note = await store.create({ bytes: Buffer.from('a'), durationMs: 1, mimeType: 'audio/webm', source: 'mic' });
  outbox.record({ op: 'note.update', id: note.id, fields: { title: 'x' } }, 0);
  outbox.record({ op: 'page.setBody', id: 'p', body: 'a' }, 0);
  const batch = outbox.takeBatch(1);
  expect(batch).toHaveLength(1);
  expect(outbox.takeBatch()).toHaveLength(1); // only the second is left
  outbox.release();
  expect(outbox.pending().every((e) => !e.inFlight)).toBe(true);
  outbox.takeBatch();
  outbox.ack([{ id: batch[0].mutationId, version: 7 }]);
  expect(outbox.pending().map((e) => e.entityId)).toEqual(['p']);
  expect(outbox.rowVersion('note', note.id)).toBe(7);
});
