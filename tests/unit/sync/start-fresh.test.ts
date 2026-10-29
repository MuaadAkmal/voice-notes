import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/main/settings';
import { NoteStore } from '../../../src/main/store/note-store';
import { SyncEngine } from '../../../src/main/sync/engine';
import { ReferenceServer } from './reference-server';

const dirs: string[] = [];
const stores: NoteStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

it('a new account starts fresh: notes synced to the first account are not uploaded to it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-fresh-'));
  dirs.push(dir);
  const store = NoteStore.open(dir, Date.now, () => 'PC-A');
  stores.push(store);
  let settings = { ...DEFAULT_SETTINGS };
  const port = {
    get: () => settings,
    update: (p: Partial<typeof settings>) => (settings = { ...settings, ...p }),
    applyRemote: () => undefined,
  };
  const old = await store.create({ bytes: Buffer.from('a'), durationMs: 1, mimeType: 'audio/webm', source: 'mic' });
  const engine1 = new SyncEngine(store, new ReferenceServer(), port);
  engine1.enable(settings);
  await engine1.sync(); // account 1 now has `old`
  expect(store.sync.outbox.rowVersion('note', old.id)).toBeGreaterThan(0);
  store.rename(old.id, 'edited while still on account 1'); // queued for account 1

  const fresh = await store.create({ bytes: Buffer.from('b'), durationMs: 1, mimeType: 'audio/webm', source: 'mic' });
  store.sync.outbox.ack(store.sync.outbox.takeBatch(1000).filter((e) => e.entityId === fresh.id).map((e) => ({ id: e.mutationId, version: 0 })));
  // ↑ pretend `fresh` was made while signed out of everything: never synced (version 0), nothing queued

  const account2 = new ReferenceServer();
  const engine2 = new SyncEngine(store, account2, port);
  engine2.startFresh(settings);
  expect(store.sync.state.cursor()).toBe(0);
  const queued = store.sync.outbox.pending().map((e) => e.entityId);
  expect(queued).toContain(fresh.id);
  expect(queued).not.toContain(old.id);
  await engine2.sync();
  expect((await account2.rows()).map((r) => r.id)).toContain(fresh.id);
  expect((await account2.rows()).map((r) => r.id)).not.toContain(old.id);
});
