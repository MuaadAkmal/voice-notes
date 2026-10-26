import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { guardWidgets, ensureLaterPage } from '../../../src/main/later';
import { DEFAULT_SETTINGS } from '../../../src/main/settings';
import { NoteStore, toRow } from '../../../src/main/store/note-store';
import { SyncEngine } from '../../../src/main/sync/engine';
import { applyRemotePrefs, recordPrefs } from '../../../src/main/sync/prefs';
import type { Settings } from '../../../src/shared/channels';
import { SYNCED_KEYS } from '../../../src/shared/sync-ops';
import { ReferenceServer } from './reference-server';

type PC = { name: string; store: NoteStore; engine: SyncEngine; settings: () => Settings; update: (p: Partial<Settings>) => void };
const dirs: string[] = [];
let ids = 0;
const newId = () => `w${++ids}`;

function pc(name: string, server: ReferenceServer, start: number): PC {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vn-conv-${name}-`));
  dirs.push(dir);
  let clock = start;
  const store = NoteStore.open(dir, () => (clock += 1000), () => name);
  open.push(store);
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const updateSettings = (patch: Partial<Settings>, opts: { record?: boolean } = {}) => {
    patch = guardWidgets(patch, settings, newId);
    settings = { ...settings, ...patch };
    if (opts.record !== false) recordPrefs(patch, store.sync.outbox);
    return settings;
  };
  const engine = new SyncEngine(store, server, (prefs) =>
    applyRemotePrefs(prefs, { getSettings: () => settings, updateSettings, pages: store.pages, deviceName: name }),
  );
  return { name, store, engine, settings: () => settings, update: (p) => void updateSettings(p) };
}

function pair() {
  const server = new ReferenceServer();
  const a = pc('PC-A', server, 1_000_000);
  const b = pc('PC-B', server, 2_000_000);
  return { server, a, b };
}

const enable = (p: PC) => p.engine.enable(p.settings());
const snapshot = (p: PC) => ({
  notes: p.store.list().map(toRow).sort((x, y) => x.id.localeCompare(y.id)),
  pages: p.store.pages.list().sort((x, y) => x.id.localeCompare(y.id)),
  folders: p.store.folders.list().sort((x, y) => x.id.localeCompare(y.id)),
  prefs: Object.fromEntries(SYNCED_KEYS.map((k) => [k, p.settings()[k]])),
});

/** Syncs in the given order until nothing changes, then checks both PCs hold the same data. */
async function converge(order: PC[]) {
  for (const p of [...order, ...order]) await p.engine.sync();
  expect(snapshot(order[0])).toEqual(snapshot(order[1]));
  expect(order.every((p) => p.store.sync.outbox.pending().length === 0)).toBe(true);
}

/** Runs a scenario twice: syncing A first, then B first. */
function both(name: string, scenario: (a: PC, b: PC, server: ReferenceServer) => Promise<void>) {
  for (const first of ['A', 'B']) {
    it(`${name} (${first} syncs first)`, async () => {
      const { server, a, b } = pair();
      enable(a);
      enable(b);
      await scenario(...((first === 'A' ? [a, b] : [b, a]) as [PC, PC]), server);
    });
  }
}

const open: NoteStore[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const audio = () => ({ bytes: Buffer.from('abc'), durationMs: 1500, mimeType: 'audio/webm;codecs=opus', source: 'mic' as const });

both('a rename on one PC and a star on the other both survive', async (a, b) => {
  const n = await a.store.create(audio());
  await a.engine.sync();
  await b.engine.sync();
  a.store.rename(n.id, 'Spanish verbs');
  b.store.setStarred([n.id], true);
  await converge([a, b]);
  expect(b.store.get(n.id)).toMatchObject({ title: 'Spanish verbs', starred: true });
});

both('the same page edited on both keeps both texts', async (a, b) => {
  const p = a.store.pages.create(null);
  a.store.pages.rename(p.id, 'Plan');
  await a.engine.sync();
  await b.engine.sync();
  a.store.pages.setBody(p.id, `text from ${a.name}`);
  b.store.pages.setBody(p.id, `text from ${b.name}`);
  await converge([a, b]);
  const pages = a.store.pages.list();
  expect(pages).toHaveLength(2);
  expect(pages.map((x) => x.body).sort()).toEqual([`text from ${a.name}`, `text from ${b.name}`].sort());
  expect(pages.find((x) => x.id !== p.id)!.title).toMatch(/^Plan \(conflict, PC-[AB]\)$/);
});

both('a quick-add entry survives a body edit on the other PC', async (a, b) => {
  const p = a.store.pages.create(null);
  a.store.pages.setBody(p.id, 'intro');
  await a.engine.sync();
  await b.engine.sync();
  a.store.pages.appendEntry(p.id, 'buy milk');
  b.store.pages.setBody(p.id, 'intro, edited');
  await converge([a, b]);
  const [page] = a.store.pages.list();
  expect(page.body).toContain('intro, edited');
  expect(page.body).toContain('buy milk');
  expect(a.store.pages.list()).toHaveLength(1);
});

both('folders moved into each other never make a loop', async (a, b) => {
  const x = a.store.folders.create('X', null);
  const y = a.store.folders.create('Y', null);
  await a.engine.sync();
  await b.engine.sync();
  a.store.folders.move(x.id, y.id);
  b.store.folders.move(y.id, x.id);
  await converge([a, b]);
  const folders = a.store.folders.list();
  const parents = Object.fromEntries(folders.map((f) => [f.id, f.parentId]));
  expect(parents[x.id] === y.id && parents[y.id] === x.id).toBe(false);
});

both('a delete wins over a rename', async (a, b) => {
  const n = await a.store.create(audio());
  await a.engine.sync();
  await b.engine.sync();
  await a.store.delete(n.id);
  b.store.rename(n.id, 'renamed');
  await converge([a, b]);
  expect(a.store.get(n.id)).toBeUndefined();
  expect(b.store.get(n.id)).toBeUndefined();
});

both('a push whose answer is lost is not applied twice', async (a, b, server) => {
  const p = a.store.pages.create(null);
  await a.engine.sync();
  a.store.pages.appendEntry(p.id, 'once');
  server.dropNextAck();
  await expect(a.engine.sync()).rejects.toThrow('connection lost');
  await converge([a, b]);
  expect(b.store.pages.get(p.id)!.body.match(/once/g)).toHaveLength(1);
});

it('two PCs with their own data end up with everything, and one Review later page', async () => {
  const { a, b } = pair();
  for (const p of [a, b]) {
    const later = ensureLaterPage(p.settings(), p.store.pages, newId);
    if (later) p.update(later);
    p.store.pages.appendEntry(p.settings().laterPageId!, `link from ${p.name}`);
    await p.store.create(audio());
    p.store.folders.create(`Folder ${p.name}`, null);
    p.store.folders.create('Shared name', null);
  }
  enable(a);
  enable(b);
  await converge([a, b]);
  expect(a.store.list()).toHaveLength(2);
  expect(a.store.folders.list().map((f) => f.name).sort()).toEqual(['Folder PC-A', 'Folder PC-B', 'Shared name', 'Shared name (2)']);
  const locked = a.settings().homeWidgets.filter((w) => w.locked);
  expect(locked).toHaveLength(1);
  expect(locked[0].pageId).toBe(a.settings().laterPageId);
  const titles = a.store.pages.list().map((p) => p.title).sort();
  expect(titles).toHaveLength(2);
  expect(titles).toContain('Review later');
  expect(titles.find((t) => t !== 'Review later')).toMatch(/^Review later \(PC-[AB]\)$/);
  // nothing saved on either PC is lost
  const bodies = a.store.pages.list().map((p) => p.body).join('\n');
  expect(bodies).toContain('link from PC-A');
  expect(bodies).toContain('link from PC-B');
});

both('a note moved into a folder the other PC deleted ends up in its parent', async (a, b) => {
  const top = a.store.folders.create('Top', null);
  const f = a.store.folders.create('F', top.id);
  const n = await a.store.create(audio());
  await a.engine.sync();
  await b.engine.sync();
  a.store.folders.delete(f.id);
  b.store.moveNotes([n.id], f.id);
  await converge([a, b]);
  expect(a.store.get(n.id)!.folderId).toBe(top.id);
  expect(a.store.folders.get(f.id)).toBeUndefined();
});

it('the outbox empties and the cursor advances', async () => {
  const { a, b } = pair();
  enable(a);
  enable(b);
  a.store.pages.create(null);
  await a.engine.sync();
  await b.engine.sync();
  expect(a.store.sync.outbox.pending()).toEqual([]);
  expect(b.store.sync.state.cursor()).toBeGreaterThan(0);
  expect(b.store.pages.list()).toHaveLength(1);
});
