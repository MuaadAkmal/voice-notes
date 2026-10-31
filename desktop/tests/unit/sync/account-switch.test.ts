import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/main/settings';
import { NoteStore } from '../../../src/main/store/note-store';
import { AccountChanged, SyncEngine } from '../../../src/main/sync/engine';
import type { PullRequest, PullResponse, PushRequest, PushResponse, SyncServer } from '../../../src/shared/sync/protocol';
import { ReferenceServer } from './reference-server';

/** A server whose next call waits until released: a slow network. */
class GatedServer implements SyncServer {
  private gate: Promise<void> | null = null;
  private open: () => void = () => undefined;
  constructor(readonly inner: ReferenceServer) {}
  hold(): void {
    this.gate = new Promise((r) => (this.open = r));
  }
  release(): void {
    this.open();
    this.gate = null;
  }
  async push(req: PushRequest): Promise<PushResponse> {
    const g = this.gate;
    const res = await this.inner.push(req);
    if (g) await g;
    return res;
  }
  async pull(req: PullRequest): Promise<PullResponse> {
    const g = this.gate;
    const res = await this.inner.pull(req);
    if (g) await g;
    return res;
  }
}

const dirs: string[] = [];
const stores: NoteStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-switch-'));
  dirs.push(dir);
  const store = NoteStore.open(dir, Date.now, () => 'PC-A');
  stores.push(store);
  let settings = { ...DEFAULT_SETTINGS };
  const port = { get: () => settings, update: (p: Partial<typeof settings>) => (settings = { ...settings, ...p }), applyRemote: () => undefined };
  const server = new GatedServer(new ReferenceServer());
  const engine = new SyncEngine(store, server, port);
  return { store, server, engine, settings: () => settings };
}

it('a push in flight when the account changes is not acknowledged into the new account\'s state', async () => {
  const { store, server, engine, settings } = setup();
  const note = await store.create({ bytes: Buffer.from('a'), durationMs: 1, mimeType: 'audio/webm', source: 'mic' });
  engine.enable(settings());
  server.hold();
  const run = engine.sync();
  await new Promise((r) => setTimeout(r, 10)); // the push is now waiting on the network
  engine.startFresh(settings()); // signed in as someone else and turned sync on
  server.release();
  await expect(run).rejects.toBeInstanceOf(AccountChanged);
  // The old account's ack must not mark the row as known to the new account.
  expect(store.sync.outbox.rowVersion('note', note.id)).toBe(0);
  expect(store.sync.state.cursor()).toBe(0);
});

it('a pull in flight when the account changes does not move the new account\'s cursor', async () => {
  const { store, server, engine, settings } = setup();
  await server.inner.push({
    clientId: 'other',
    deviceName: 'B',
    mutations: [{ id: 'm1', op: { op: 'folder.create', id: 'f', row: { id: 'f', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 } }, baseVersion: 0 }],
  });
  engine.enable(settings());
  server.hold();
  const run = engine.sync();
  await new Promise((r) => setTimeout(r, 10));
  engine.startFresh(settings());
  server.release();
  await expect(run).rejects.toBeInstanceOf(AccountChanged);
  expect(store.sync.state.cursor()).toBe(0);
  expect(store.folders.list()).toEqual([]);
});
