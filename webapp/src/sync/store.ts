import type { PullResponse } from "@wire/sync/protocol";
import type { FolderRow, NoteRow, PageRow } from "@wire/sync-ops";
import { applyWebOp, type WebOp } from "@/lib/apply-op";

export type Versioned<T> = { data: T; version: number };
export type Entity = "note" | "page" | "folder";

export type Snapshot = {
  notes: ReadonlyMap<string, Versioned<NoteRow>>;
  pages: ReadonlyMap<string, Versioned<PageRow>>;
  folders: ReadonlyMap<string, Versioned<FolderRow>>;
  laterPageId: string | null;
  notesPageId: string | null;
  cursor: number;
  loaded: boolean;
};

type Tables = { note: Map<string, Versioned<NoteRow>>; page: Map<string, Versioned<PageRow>>; folder: Map<string, Versioned<FolderRow>> };

const entityOf = (op: WebOp) => op.op.split(".")[0] as Entity;

/** The account's rows as this browser knows them: the server's, with unacked local edits on top. */
export class WebStore {
  private tables: Tables = { note: new Map(), page: new Map(), folder: new Map() };
  private meta = { laterPageId: null as string | null, notesPageId: null as string | null, cursor: 0, loaded: false };
  private snap: Snapshot | null = null;
  private listeners = new Set<() => void>();

  snapshot = (): Snapshot => {
    this.snap ??= {
      notes: new Map(this.tables.note),
      pages: new Map(this.tables.page),
      folders: new Map(this.tables.folder),
      ...this.meta,
    };
    return this.snap;
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  version(entity: Entity, id: string): number {
    return this.tables[entity].get(id)?.version ?? 0;
  }

  setVersion(entity: Entity, id: string, version: number): void {
    const row = this.tables[entity].get(id);
    if (!row || row.version >= version) return;
    (this.tables[entity] as Map<string, Versioned<unknown>>).set(id, { ...row, version });
    this.changed();
  }

  applyLocal(op: WebOp): void {
    this.apply(op);
    this.changed();
  }

  applyPull(res: PullResponse, pending: readonly WebOp[]): void {
    const touched = new Set<string>();
    for (const row of res.rows) {
      const table = this.tables[row.entity] as Map<string, Versioned<unknown>>;
      if (row.deleted || !row.data) table.delete(row.id);
      else table.set(row.id, { data: row.data, version: row.version });
      touched.add(`${row.entity}:${row.id}`);
    }
    for (const pref of res.prefs) {
      if (pref.key === "laterPageId" || pref.key === "notesPageId") this.meta[pref.key] = typeof pref.value === "string" ? pref.value : null;
    }
    // Rows this pull didn't touch already carry the local edits.
    for (const op of pending) if (touched.has(`${entityOf(op)}:${op.id}`)) this.apply(op);
    this.meta.cursor = res.cursor;
    this.changed();
  }

  markLoaded(): void {
    if (this.meta.loaded) return;
    this.meta.loaded = true;
    this.changed();
  }

  private apply(op: WebOp): void {
    const table = this.tables[entityOf(op)] as Map<string, Versioned<unknown>>;
    const current = table.get(op.id);
    const next = applyWebOp(current?.data, op);
    if (next === undefined) table.delete(op.id);
    else table.set(op.id, { data: next, version: current?.version ?? 0 });
  }

  private changed(): void {
    this.snap = null;
    for (const fn of this.listeners) fn();
  }
}
