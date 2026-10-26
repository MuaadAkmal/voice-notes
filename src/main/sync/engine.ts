import type { HomeWidget, Settings } from '../../shared/channels';
import { MAX_HOME_WIDGETS } from '../../shared/home-widgets';
import { type FolderRow, SYNCED_KEYS, type SyncedKey } from '../../shared/sync-ops';
import { type NoteStore, toRow } from '../store/note-store';
import { applyPull } from './apply';

// The contract between a PC and the sync server. The reference server in tests/unit/sync implements
// it in memory; piece C implements it on Supabase.

import type { PullResponse, SyncServer } from '../../shared/sync/protocol';

export type { PullResponse, PushRequest, PushResponse, ServerRow, SyncServer } from '../../shared/sync/protocol';

/** How the engine reaches settings.json (main's updateSettings; records synced keys unless record: false). */
export type SettingsPort = {
  get(): Settings;
  update(patch: Partial<Settings>, opts?: { record?: boolean }): Settings;
  applyRemote(prefs: PullResponse['prefs']): void;
};

const PUSH_BATCH = 100;
const MAX_ROUNDS = 3; // push → pull → push again at most this often per run, so a bad merge can't spin

/** Pushes this PC's waiting changes, then pulls everything new, one run at a time. */
export class SyncEngine {
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly store: NoteStore,
    private readonly server: SyncServer,
    private readonly settings: SettingsPort,
  ) {}

  /**
   * Turns sync on for this PC and queues everything it already has (folders before what's in them),
   * so the first sync uploads it and merges it with the account. Already on: nothing to do.
   */
  enable(settings: Settings): void {
    const { state, outbox } = this.store.sync;
    if (state.enabled()) return;
    const { sqlite } = this.store.syncAccess();
    sqlite.transaction(() => {
      state.setEnabled(true);
      for (const folder of parentsFirst(this.store.folders.list())) outbox.record({ op: 'folder.create', id: folder.id, row: folder }, 0);
      for (const page of this.store.pages.list()) outbox.record({ op: 'page.create', id: page.id, row: page }, 0);
      for (const note of this.store.list()) outbox.record({ op: 'note.create', id: note.id, row: toRow(note) }, 0);
      // Settings wait for the first pull: the account's win, this PC only adds what the account lacks.
      state.setPendingPrefs(Object.fromEntries(SYNCED_KEYS.map((key) => [key, settings[key]])));
    })();
  }

  /** A call while a run is going returns that run, and one more run follows it. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        await this.mergeFirstPrefs();
        let rounds = 0;
        do {
          this.again = false;
          await this.push();
          await this.pull();
          // A pull can itself queue changes (the Review later merge renames our old page): send them now.
          if (this.store.sync.outbox.pending().length && ++rounds < MAX_ROUNDS) this.again = true;
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async push(): Promise<void> {
    const { state, outbox } = this.store.sync;
    for (let batch = outbox.takeBatch(PUSH_BATCH); batch.length; batch = outbox.takeBatch(PUSH_BATCH)) {
      try {
        const res = await this.server.push({
          clientId: state.deviceId(),
          deviceName: state.deviceName(),
          mutations: batch.map((e) => ({ id: e.mutationId, op: e.op, baseVersion: e.baseVersion })),
        });
        outbox.ack(res.acked);
      } catch (err) {
        outbox.release(); // all of it goes again next time; the server applies each change once
        throw err;
      }
    }
  }

  private async pull(seen?: Set<SyncedKey>): Promise<void> {
    const { state } = this.store.sync;
    let res: PullResponse;
    do {
      res = await this.server.pull({ clientId: state.deviceId(), cursor: state.cursor() });
      applyPull(this.store, res, (prefs) => {
        for (const p of prefs) seen?.add(p.key);
        this.settings.applyRemote(prefs);
      });
    } while (res.hasMore);
  }

  /**
   * First run after turning sync on: pull the account's settings before sending ours. The account's
   * values win; a key the account doesn't have yet takes ours; Home keeps the account's cards and
   * adds this PC's own (its locked Review later card now points at the account's page).
   */
  private async mergeFirstPrefs(): Promise<void> {
    const { state } = this.store.sync;
    const local = state.pendingPrefs();
    if (!local) return;
    const seen = new Set<SyncedKey>();
    await this.pull(seen);
    for (const key of SYNCED_KEYS) {
      if (key === 'homeWidgets' && seen.has(key)) {
        const account = this.settings.get().homeWidgets;
        const ours = (local.homeWidgets as HomeWidget[]).filter(
          (w) => !w.locked && !account.some((a) => a.id === w.id || (a.type === w.type && a.pageId === w.pageId)),
        );
        if (ours.length) this.settings.update({ homeWidgets: [...account, ...ours].slice(0, MAX_HOME_WIDGETS + 1) });
      } else if (!seen.has(key)) {
        this.settings.update({ [key]: local[key] } as Partial<Settings>);
      }
    }
    state.setPendingPrefs(null);
  }
}

/** Folders ordered so every parent comes before its children. */
function parentsFirst(folders: FolderRow[]): FolderRow[] {
  const out: FolderRow[] = [];
  const placed = new Set<string>();
  let left = folders;
  while (left.length) {
    const ready = left.filter((f) => !f.parentId || placed.has(f.parentId) || !folders.some((p) => p.id === f.parentId));
    if (!ready.length) return [...out, ...left]; // a loop can't happen locally; never spin
    for (const f of ready) {
      out.push(f);
      placed.add(f.id);
    }
    left = left.filter((f) => !placed.has(f.id));
  }
  return out;
}
