import type { Settings } from '../../shared/channels';
import { type FolderRow, type NoteRow, type PageRow, SYNCED_KEYS, type SyncedKey, type SyncOp } from '../../shared/sync-ops';
import { type NoteStore, toRow } from '../store/note-store';
import { applyPull } from './apply';

// The contract between a PC and the sync server. The reference server in tests/unit/sync implements
// it in memory; piece C implements it on Supabase.

export type PushRequest = {
  clientId: string;
  deviceName: string;
  mutations: { id: string; op: SyncOp; baseVersion: number }[];
};
export type PushResponse = { acked: { id: string; version: number }[] };

export type ServerRow =
  | { entity: 'note'; id: string; version: number; deleted: boolean; data: NoteRow | null }
  | { entity: 'page'; id: string; version: number; deleted: boolean; data: PageRow | null }
  | { entity: 'folder'; id: string; version: number; deleted: boolean; data: FolderRow | null };

export type PullResponse = {
  cursor: number;
  hasMore: boolean;
  rows: ServerRow[];
  prefs: { key: SyncedKey; value: unknown; version: number }[];
};

export type SyncServer = {
  push(req: PushRequest): Promise<PushResponse>;
  pull(req: { clientId: string; cursor: number }): Promise<PullResponse>;
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
    private readonly onPrefs: (prefs: PullResponse['prefs']) => void,
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
      for (const key of SYNCED_KEYS) outbox.record({ op: 'prefs.set', key, value: settings[key] }, 0);
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

  private async pull(): Promise<void> {
    const { state } = this.store.sync;
    let res: PullResponse;
    do {
      res = await this.server.pull({ clientId: state.deviceId(), cursor: state.cursor() });
      applyPull(this.store, res, this.onPrefs);
    } while (res.hasMore);
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
