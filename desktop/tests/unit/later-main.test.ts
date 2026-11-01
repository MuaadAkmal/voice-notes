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
const ARTICLE = 'https://example.com/some/article';
const link = (url: string): DropPayload => ({ text: url, uriList: url, html: `<a href="${url}">The duality of this sub is insame</a>` });
const LINK = link(ARTICLE);
const REDDIT = 'https://www.reddit.com/r/x/comments/1/a/';
let store: NoteStore;
let settings: Settings;

const deps = (source: string | null = 'Reddit', win: { title: string; processName: string } | null = null) => ({
  window: () => win,
  pages: store.pages,
  getSettings: () => settings,
  // What index.ts updateSettings does: the widget guard runs on every patch.
  updateSettings: (p: Partial<Settings>) => (settings = { ...settings, ...guardWidgets(p, settings, randomUUID) }),
  source: () => source,
  newId: randomUUID,
});
const laterBody = () => store.pages.get(settings.laterPageId!)!.body;
const pagesTitled = (title: string) => store.pages.list().filter((p) => p.title === title);

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
  expect(saveDrop(LINK, deps())).toEqual({ kind: 'saved', page: 'Review later' });
  expect(laterBody()).toBe(`## 24 Oct 2026\n- [ ] [The duality of this sub is insame](${ARTICLE}) · Reddit\n`);
});

it("a link from a known site goes on that site's page, made on first use, and Review later stays clean", () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  expect(saveDrop(link(REDDIT), deps(null))).toEqual({ kind: 'saved', page: 'Reddit' });
  saveDrop(link(`${REDDIT}2`), deps(null));
  const [page, ...others] = pagesTitled('Reddit');
  expect(others).toEqual([]);
  expect(page.body).toBe(
    `## 24 Oct 2026\n- [ ] [The duality of this sub is insame](${REDDIT})\n- [ ] [The duality of this sub is insame](${REDDIT}2)\n`,
  );
  expect(laterBody()).toBe('');
});

const REDDIT_TAB = { title: 'A thread : r/rust - Google Chrome', processName: 'chrome.exe' };

it('text and links to elsewhere go by the tab they were dragged from', () => {
  expect(saveDrop({ text: 'a good line', uriList: '', html: '' }, deps(null, REDDIT_TAB))).toEqual({ kind: 'saved', page: 'Reddit' });
  expect(saveDrop(LINK, deps(null, REDDIT_TAB))).toEqual({ kind: 'saved', page: 'Reddit' });
  expect(pagesTitled('Reddit')[0].body).toContain('- [ ] a good line\n');
});

it("a link's own site beats the tab it was dragged from", () => {
  expect(saveDrop(link('https://youtu.be/x'), deps(null, REDDIT_TAB))).toEqual({ kind: 'saved', page: 'YouTube' });
  expect(pagesTitled('Reddit')).toEqual([]);
});

it('uses a page the user already has, whatever its case or folder, and reports its title', () => {
  const mine = store.pages.create(null).id;
  store.pages.rename(mine, 'reddit');
  expect(saveDrop(link(REDDIT), deps(null))).toEqual({ kind: 'saved', page: 'reddit' });
  expect(store.pages.get(mine)!.body).toContain(REDDIT);
  expect(pagesTitled('Reddit')).toEqual([]);
});

it('a deleted app page comes back on the next save', async () => {
  saveDrop(link(REDDIT), deps(null));
  await store.pages.deleteMany([pagesTitled('Reddit')[0].id]);
  saveDrop(link(`${REDDIT}2`), deps(null));
  expect(pagesTitled('Reddit')[0].body).toContain(`${REDDIT}2`);
  expect(pagesTitled('Reddit')[0].body).not.toContain(`${REDDIT})`);
});

it('with two pages of the same name (two PCs each made one) the oldest is used', () => {
  let now = T0;
  store.close();
  store = NoteStore.open(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-later-')), () => now);
  const older = store.pages.create(null).id;
  store.pages.rename(older, 'Reddit');
  now += 1000;
  const newer = store.pages.create(null).id;
  store.pages.rename(newer, 'Reddit');
  saveDrop(link(REDDIT), deps(null));
  expect(store.pages.get(older)!.body).toContain(REDDIT);
  expect(store.pages.get(newer)!.body).toBe('');
});

it('saveDrop ignores an empty drop', () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  expect(saveDrop({ text: ' ', uriList: '', html: '' }, deps())).toEqual({ kind: 'ignored' });
  expect(laterBody()).toBe('');
});

it('saveDrop recreates a page that vanished outside the app', async () => {
  settings = { ...settings, ...ensureLaterPage(settings, store.pages, randomUUID)! };
  await store.pages.deleteMany([settings.laterPageId!]);
  expect(saveDrop({ text: 'serendipity', uriList: '', html: '' }, deps(null))).toEqual({ kind: 'saved', page: 'Review later' });
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
  const docs = { hwnd: 4, title: 'A doc - Google Chrome', processName: 'chrome.exe', pid: 7 };
  const r = await saveCapture(captureDeps(docs, { label: 'A doc', app: 'Chrome', url: ARTICLE }));
  expect(r).toEqual({ kind: 'saved', label: 'A doc', page: 'Review later' });
  expect(laterBody()).toContain(`- [ ] [A doc](${ARTICLE})`);
});

it("Save this on a known site goes on that site's page, by address or else by title", async () => {
  const byUrl = await saveCapture(captureDeps(CHROME, { label: 'How Rust lifetimes work', app: 'Chrome', url: 'https://youtube.com/watch?v=x' }));
  expect(byUrl).toEqual({ kind: 'saved', label: 'How Rust lifetimes work', page: 'YouTube' });
  expect(pagesTitled('YouTube')[0].body).toContain('- [ ] [How Rust lifetimes work](https://youtube.com/watch?v=x)');

  // The address bar couldn't be read, so it's a screenshot; the title still says where it belongs.
  const byTitle = await saveCapture(captureDeps(CHROME, { label: 'Another', app: 'Chrome', image: new Uint8Array([1]) }));
  expect(byTitle).toEqual({ kind: 'saved', label: 'Another', page: 'YouTube' });
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
