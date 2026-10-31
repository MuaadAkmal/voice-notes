import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DropPayload, Settings } from '../../src/shared/channels';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { ensureLaterPage, guardWidgets, saveCapture, saveDrop } from '../../src/main/later';
import type { Capture } from '../../src/main/commands/capture';
import type { Described } from '../../src/main/commands/describe';
import { NoteStore } from '../../src/main/store/note-store';

const T0 = new Date(2026, 9, 24, 14, 32).getTime();
const REDDIT = 'https://www.reddit.com/r/x/comments/1/a/';
const LINK: DropPayload = {
  text: REDDIT,
  uriList: REDDIT,
  html: `<a href="${REDDIT}">The duality of this sub is insame</a>`,
};
let store: NoteStore;
let settings: Settings;

const deps = (source: string | null = 'Reddit') => ({
  pages: store.pages,
  getSettings: () => settings,
  // What index.ts updateSettings does: the widget guard runs on every patch.
  updateSettings: (p: Partial<Settings>) => (settings = { ...settings, ...guardWidgets(p, settings, randomUUID) }),
  source: () => source,
  newId: randomUUID,
});
const laterBody = () => store.pages.get(settings.laterPageId!)!.body;

beforeEach(() => {
  store = NoteStore.open(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-later-')), () => T0);
  settings = { ...DEFAULT_SETTINGS };
});
afterEach(() => store.close());

it('creates the Review later page and its locked widget, once', () => {
  const patch = ensureLaterPage(settings, store.pages, randomUUID)!;
  settings = { ...settings, ...patch };
  const page = store.pages.get(settings.laterPageId!)!;
  expect(page.title).toBe('Review later');
  expect(settings.homeWidgets[0]).toMatchObject({ type: 'page', pageId: page.id, locked: true });
  expect(ensureLaterPage(settings, store.pages, randomUUID)).toBeNull();
});

it('recreates the page when its row is gone, replacing the stale locked widget', async () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  const old = settings.laterPageId!;
  await store.pages.deleteMany([old]);
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  expect(settings.laterPageId).not.toBe(old);
  expect(settings.homeWidgets.filter((w) => w.locked)).toEqual([expect.objectContaining({ pageId: settings.laterPageId })]);
});

it('only adds the widget when the page exists but the widget is missing', () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  const patch = ensureLaterPage({ ...settings, homeWidgets: [] }, store.pages, randomUUID);
  expect(patch).toEqual({ homeWidgets: [expect.objectContaining({ pageId: settings.laterPageId, locked: true })] });
});

it('saveDrop appends a checkbox line under today', () => {
  expect(saveDrop(LINK, deps())).toBe('saved');
  expect(laterBody()).toBe(`## 24 Oct 2026\n- [ ] [The duality of this sub is insame](${REDDIT}) · Reddit\n`);
});

it('saveDrop ignores an empty drop', () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  expect(saveDrop({ text: ' ', uriList: '', html: '' }, deps())).toBe('ignored');
  expect(laterBody()).toBe('');
});

it('saveDrop recreates a page that vanished outside the app', async () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  await store.pages.deleteMany([settings.laterPageId!]);
  expect(saveDrop({ text: 'serendipity', uriList: '', html: '' }, deps(null))).toBe('saved');
  expect(store.pages.get(settings.laterPageId!)!.title).toBe('Review later');
  expect(laterBody()).toContain('- [ ] serendipity\n');
});

it('recreating the page during a drop leaves exactly one locked card, for the new page', async () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  await store.pages.deleteMany([settings.laterPageId!]);
  saveDrop({ text: 'serendipity', uriList: '', html: '' }, deps(null));
  expect(settings.homeWidgets.filter((w) => w.locked)).toEqual([expect.objectContaining({ pageId: settings.laterPageId })]);
});

it('guardWidgets drops locked flags for other pages and re-adds the real card', () => {
  const later = randomUUID();
  const other = randomUUID();
  const patch = guardWidgets(
    { homeWidgets: [{ id: randomUUID(), type: 'page', pageId: other, locked: true }] },
    { ...settings, laterPageId: later },
    () => 'w',
  );
  expect(patch.homeWidgets).toEqual([{ id: 'w', type: 'page', pageId: later, locked: true }]);
});

const CHROME: Capture = { hwnd: 1, title: 'How Rust lifetimes work - YouTube - Google Chrome', processName: 'chrome.exe', pid: 7 };
const captureDeps = (capture: Capture | null, described: Described) => ({
  ...deps(),
  capture: () => capture,
  describe: async () => described,
  saveImage: async () => 'vn-image://shot.jpg',
});

it('Save this writes the window in front to Review later as an unticked line', async () => {
  const r = await saveCapture(captureDeps(CHROME, { label: 'How Rust lifetimes work', app: 'Chrome', url: 'https://youtube.com/watch?v=x' }));
  expect(r).toEqual({ kind: 'saved', label: 'How Rust lifetimes work' });
  expect(laterBody()).toContain('- [ ] [How Rust lifetimes work](https://youtube.com/watch?v=x)');
});

it('Save this keeps a screenshot when nothing else could be read', async () => {
  const shot = { hwnd: 2, title: 'Game', processName: 'game.exe', pid: 8 };
  await saveCapture(captureDeps(shot, { label: 'Game', app: 'game', image: new Uint8Array([1]) }));
  expect(laterBody()).toContain('- [ ] Game ![Game](vn-image://shot.jpg)');
});

it('Save this saves nothing with no window or only the desktop in front', async () => {
  const d: Described = { label: 'x', app: 'x' };
  expect(await saveCapture(captureDeps(null, d))).toEqual({ kind: 'nothing' });
  expect(await saveCapture(captureDeps({ hwnd: 3, title: 'Program Manager', processName: 'explorer.exe', pid: 9 }, d))).toEqual({ kind: 'nothing' });
  expect(settings.laterPageId).toBeNull();
});
