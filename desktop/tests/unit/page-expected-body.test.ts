import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NoteStore } from '../../src/main/store/note-store';

let root: string;
let store: NoteStore;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-expected-'));
  store = NoteStore.open(root, () => 1000, () => 'PC-A');
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('a save based on old text keeps the text that changed underneath as another version', () => {
  const p = store.pages.create(null);
  store.pages.rename(p.id, 'Plan');
  store.pages.setBody(p.id, 'start');
  store.pages.setBody(p.id, 'from the other PC'); // arrived by sync while the editor showed "start"
  store.pages.setBody(p.id, 'start, typed here', 'start');
  const pages = store.pages.list();
  expect(store.pages.get(p.id)!.body).toBe('start, typed here');
  const copy = pages.find((x) => x.id !== p.id)!;
  expect(copy).toMatchObject({ title: 'Plan (other version)', body: 'from the other PC', folderId: null });
});

it('no copy when nothing changed underneath, or when it already says the same', () => {
  const p = store.pages.create(null);
  store.pages.setBody(p.id, 'a');
  store.pages.setBody(p.id, 'ab', 'a');
  store.pages.setBody(p.id, 'ab', 'old'); // the stored text is already this
  expect(store.pages.list()).toHaveLength(1);
});

it('the copy syncs like any page', () => {
  store.sync.state.setEnabled(true);
  const p = store.pages.create(null);
  store.pages.setBody(p.id, 'theirs');
  store.pages.setBody(p.id, 'mine', 'base');
  const ops = store.sync.outbox.pending().map((e) => e.op.op);
  expect(ops.filter((o) => o === 'page.create')).toHaveLength(2);
});
