import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { NoteStore } from '../../src/main/store/note-store';
import { applyRemotePrefs, mergeLaterPage, recordPrefs } from '../../src/main/sync/prefs';
import type { HomeWidget, Settings } from '../../src/shared/channels';

let root: string;
let store: NoteStore;
const ops = () => store.sync.outbox.pending().map((e) => e.op);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-prefs-'));
  store = NoteStore.open(root, () => 1000, () => 'PC-A');
  store.sync.state.setEnabled(true);
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

it('records only the settings that follow the account', () => {
  const homeWidgets: HomeWidget[] = [];
  recordPrefs({ homeWidgets, theme: 'dark', hotkey: [1] }, store.sync.outbox);
  expect(ops()).toEqual([{ op: 'prefs.set', key: 'homeWidgets', value: [] }]);
});

it('the other PC\'s Review later page wins; ours is kept as a normal page', () => {
  const ours = store.pages.create(null);
  store.pages.rename(ours.id, 'Review later');
  store.pages.setBody(ours.id, '- [ ] link');
  const theirs = store.pages.create(null);
  const quick: HomeWidget = { id: 'q', type: 'quick-add', pageId: theirs.id, label: 'Learn' };
  const local: Settings = {
    ...DEFAULT_SETTINGS,
    laterPageId: ours.id,
    homeWidgets: [{ id: 'l', type: 'page', pageId: ours.id, locked: true }, quick],
  };
  const patch = mergeLaterPage(local, theirs.id, store.pages, 'PC-A');
  expect(patch.laterPageId).toBe(theirs.id);
  expect(patch.homeWidgets!.filter((w) => w.locked)).toEqual([{ id: 'l', type: 'page', pageId: theirs.id, locked: true }]);
  expect(patch.homeWidgets).toContainEqual(quick);
  expect(store.pages.get(ours.id)).toMatchObject({ title: 'Review later (PC-A)', body: '- [ ] link' });
});

it('applies remote settings without sending them back, the Review later page first', () => {
  const ours = store.pages.create(null);
  const theirs = store.pages.create(null);
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    laterPageId: ours.id,
    homeWidgets: [{ id: 'l', type: 'page', pageId: ours.id, locked: true }],
  };
  const calls: { patch: Partial<Settings>; record: boolean | undefined }[] = [];
  const before = ops().length;
  applyRemotePrefs(
    [
      { key: 'transcribeLanguage', value: 'es' },
      { key: 'laterPageId', value: theirs.id },
    ],
    {
      getSettings: () => settings,
      updateSettings: (patch, opts) => {
        calls.push({ patch, record: opts?.record });
        settings = { ...settings, ...patch };
        return settings;
      },
      pages: store.pages,
      deviceName: 'PC-A',
    },
  );
  expect(calls.map((c) => Object.keys(c.patch))).toEqual([['laterPageId', 'homeWidgets'], ['transcribeLanguage']]);
  expect(calls.every((c) => c.record === false)).toBe(true);
  expect(settings).toMatchObject({ transcribeLanguage: 'es', laterPageId: theirs.id });
  // only the rename of our old page goes back out, not the settings themselves
  expect(ops().slice(before).map((o) => o.op)).toEqual(['page.update']);
});

it('a remote Review later id equal to ours changes nothing', () => {
  const ours = store.pages.create(null);
  const settings: Settings = { ...DEFAULT_SETTINGS, laterPageId: ours.id };
  const calls: Partial<Settings>[] = [];
  applyRemotePrefs([{ key: 'laterPageId', value: ours.id }], {
    getSettings: () => settings,
    updateSettings: (patch) => (calls.push(patch), settings),
    pages: store.pages,
    deviceName: 'PC-A',
  });
  expect(calls).toEqual([]);
});
