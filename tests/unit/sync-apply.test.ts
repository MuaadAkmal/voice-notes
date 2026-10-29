import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore, toRow } from '../../src/main/store/note-store';
import { applyPull } from '../../src/main/sync/apply';
import type { PullResponse, ServerRow } from '../../src/main/sync/engine';

let root: string;
let store: NoteStore;
const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });
const pull = (rows: ServerRow[], cursor = 9): PullResponse => ({ cursor, hasMore: false, rows, prefs: [] });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-apply-'));
  store = NoteStore.open(root, () => 1000, () => 'PC-A');
  store.sync.state.setEnabled(true);
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('a pulled note appears with its version, and the cursor moves', () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'From B',
    durationMs: 2000,
    sizeBytes: 9,
    mimeType: 'audio/webm',
    createdAt: 5,
    updatedAt: 6,
    folderId: null,
    source: 'mic' as const,
    kind: 'note' as const,
    windowTitle: null,
    show: null,
    starred: true,
    transcript: null,
    transcriptLang: null,
    transcribedAt: null,
  };
  applyPull(store, pull([{ entity: 'note', id: row.id, version: 4, deleted: false, data: row }]), () => undefined);
  expect(toRow(store.get(row.id)!)).toEqual(row);
  expect(store.sync.outbox.rowVersion('note', row.id)).toBe(4);
  expect(store.sync.state.cursor()).toBe(9);
  expect(store.sync.outbox.pending()).toEqual([]); // applying never queues changes
});

it('a pulled delete hides the note, removes its audio and drops our waiting changes', async () => {
  const n = await store.create(audio());
  store.rename(n.id, 'mine');
  applyPull(store, pull([{ entity: 'note', id: n.id, version: 5, deleted: true, data: null }]), () => undefined);
  expect(store.get(n.id)).toBeUndefined();
  expect(fs.existsSync(store.absolutePath(n))).toBe(false);
  expect(store.sync.outbox.pending(n.id)).toEqual([]);
});

it('a file that cannot be removed does not stop the pull', async () => {
  const n = await store.create(audio());
  const m = await store.create(audio());
  // Stands in for a file Windows keeps open: rmSync throws on it.
  fs.rmSync(store.absolutePath(n));
  fs.mkdirSync(store.absolutePath(n));
  fs.writeFileSync(path.join(store.absolutePath(n), 'x'), 'x');
  expect(() =>
    applyPull(
      store,
      pull([
        { entity: 'note', id: n.id, version: 5, deleted: true, data: null },
        { entity: 'note', id: m.id, version: 6, deleted: true, data: null },
      ]),
      () => undefined,
    ),
  ).not.toThrow();
  expect(store.get(n.id)).toBeUndefined();
  expect(fs.existsSync(store.absolutePath(m))).toBe(false);
});

it('our unsent body edit stays on top of a pulled body', () => {
  const p = store.pages.create(null);
  store.pages.setBody(p.id, 'typing…');
  applyPull(
    store,
    pull([{ entity: 'page', id: p.id, version: 3, deleted: false, data: { ...p, title: 'Renamed on B', body: 'old' } }]),
    () => undefined,
  );
  expect(store.pages.get(p.id)).toMatchObject({ title: 'Renamed on B', body: 'typing…' });
});

it('a pulled folder and a page inside it both land', () => {
  const folder = { id: 'f1', name: 'Work', parentId: null, createdAt: 1, updatedAt: 1 };
  const page = { id: 'p1', title: 'Plan', body: 'x', folderId: 'f1', starred: false, createdAt: 1, updatedAt: 1 };
  applyPull(
    store,
    pull([
      { entity: 'folder', id: 'f1', version: 1, deleted: false, data: folder },
      { entity: 'page', id: 'p1', version: 2, deleted: false, data: page },
    ]),
    () => undefined,
  );
  expect(store.folders.list()).toEqual([folder]);
  expect(store.pages.get('p1')).toEqual(page);
});

it('pulled settings are handed over after the rows', () => {
  const seen: unknown[] = [];
  applyPull(store, { cursor: 2, hasMore: false, rows: [], prefs: [{ key: 'transcribeLanguage', value: 'es', version: 2 }] }, (p) => seen.push(...p));
  expect(seen).toEqual([{ key: 'transcribeLanguage', value: 'es', version: 2 }]);
});

it('a pulled note without its file here is remote', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const row = {
    id, title: 'From B', durationMs: 2000, sizeBytes: 9, mimeType: 'audio/webm', createdAt: 5, updatedAt: 6, folderId: null,
    source: 'mic' as const, kind: 'note' as const, windowTitle: null, show: null, starred: false, transcript: null, transcriptLang: null, transcribedAt: null,
  };
  applyPull(store, pull([{ entity: 'note', id, version: 4, deleted: false, data: row }]), () => undefined);
  expect(store.get(id)!.status).toBe('remote');
});
