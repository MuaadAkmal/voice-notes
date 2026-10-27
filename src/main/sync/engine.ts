import fs from 'node:fs';
import type { HomeWidget, Settings } from '../../shared/channels';
import { imageRefs } from '../../shared/page-images';
import { MAX_HOME_WIDGETS } from '../../shared/home-widgets';
import { type FolderRow, SYNCED_KEYS, type SyncedKey } from '../../shared/sync-ops';
import { type NoteStore, toRow } from '../store/note-store';
import type { PullResponse, SyncServer } from '../../shared/sync/protocol';
import { applyPull, type PullChanges } from './apply';

export type { PullResponse, PushRequest, PushResponse, ServerRow, SyncServer } from '../../shared/sync/protocol';
export type { PullChanges } from './apply';

/** How the engine reaches settings.json (main's updateSettings; records synced keys unless record: false). */
export type SettingsPort = {
  get(): Settings;
  update(patch: Partial<Settings>, opts?: { record?: boolean }): Settings;
  applyRemote(prefs: PullResponse['prefs']): void;
};

/** The account changed while a request was in flight: its answer belongs to the old account and is dropped. */
export class AccountChanged extends Error {
  constructor() {
    super('The account changed during sync');
  }
}

const PUSH_BATCH = 100;
const MAX_ROUNDS = 3; // push → pull → push again at most this often per run, so a bad merge can't spin

/** Pushes this PC's waiting changes, then pulls everything new, one run at a time. */
export class SyncEngine {
  private running: Promise<PullChanges> | null = null;
  private again = false;
  private changes: PullChanges = noChanges();
  /** Bumped by startFresh: an answer to a request made before it is not applied. */
  private epoch = 0;

  constructor(
    private readonly store: NoteStore,
    private readonly server: SyncServer,
    private readonly settings: SettingsPort,
  ) {}

  /**
   * Turns sync on for this PC and queues everything it has that no account has seen yet (version 0;
   * folders before what's in them), so the first sync uploads it and merges it with the account.
   * Already on: nothing to do.
   */
  enable(settings: Settings): void {
    const { state, outbox } = this.store.sync;
    if (state.enabled()) return;
    const { sqlite } = this.store.syncAccess();
    sqlite.transaction(() => {
      state.setEnabled(true);
      const fresh = (entity: 'note' | 'page' | 'folder', id: string) => outbox.rowVersion(entity, id) === 0;
      for (const folder of parentsFirst(this.store.folders.list().filter((f) => fresh('folder', f.id))))
        outbox.record({ op: 'folder.create', id: folder.id, row: folder }, 0);
      for (const page of this.store.pages.list().filter((p) => fresh('page', p.id)))
        outbox.record({ op: 'page.create', id: page.id, row: page }, 0);
      const notes = this.store.list().filter((n) => fresh('note', n.id));
      for (const note of notes) outbox.record({ op: 'note.create', id: note.id, row: toRow(note) }, 0);
      // Their files too: audio that is here, and images the never-synced pages show.
      const { files } = this.store.sync;
      for (const note of notes) if (note.status === 'ok') files.record('audio', `${note.id}.webm`);
      for (const page of this.store.pages.list().filter((p) => fresh('page', p.id)))
        for (const img of imageRefs(page.body)) if (fs.existsSync(this.store.pages.imagePath(img))) files.record('image', img);
      // Settings wait for the first pull: the account's win, this PC only adds what the account lacks.
      state.setPendingPrefs(Object.fromEntries(SYNCED_KEYS.map((key) => [key, settings[key]])));
    })();
  }

  /**
   * Syncing with a different account than before: forget the old account's queue and cursor, then
   * enable. Rows the old account already has (version > 0) stay on this PC only.
   */
  startFresh(settings: Settings): void {
    const { state } = this.store.sync;
    const { sqlite } = this.store.syncAccess();
    this.epoch += 1;
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM outbox').run();
      this.store.sync.files.clear();
      state.setCursor(0);
      state.setPendingPrefs(null);
      state.setEnabled(false);
    })();
    this.enable(settings);
  }

  /** A call while a run is going returns that run, and one more run follows it. Resolves to what pulls changed. */
  sync(): Promise<PullChanges> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.changes = noChanges();
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
        return this.changes;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async push(): Promise<void> {
    const { state, outbox } = this.store.sync;
    for (let batch = outbox.takeBatch(PUSH_BATCH); batch.length; batch = outbox.takeBatch(PUSH_BATCH)) {
      const epoch = this.epoch;
      try {
        const res = await this.server.push({
          clientId: state.deviceId(),
          deviceName: state.deviceName(),
          mutations: batch.map((e) => ({ id: e.mutationId, op: e.op, baseVersion: e.baseVersion })),
        });
        if (epoch !== this.epoch) throw new AccountChanged(); // its outbox is gone; don't ack into the new account's rows
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
      const epoch = this.epoch;
      res = await this.server.pull({ clientId: state.deviceId(), cursor: state.cursor() });
      if (epoch !== this.epoch) throw new AccountChanged(); // the old account's rows and cursor
      const changed = applyPull(this.store, res, (prefs) => {
        for (const p of prefs) seen?.add(p.key);
        this.settings.applyRemote(prefs);
      });
      for (const k of Object.keys(changed) as (keyof PullChanges)[]) this.changes[k] ||= changed[k];
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

function noChanges(): PullChanges {
  return { notes: false, pages: false, folders: false, prefs: false };
}
