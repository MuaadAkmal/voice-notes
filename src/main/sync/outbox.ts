import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SyncOp } from '../../shared/sync-ops';
import type { SyncState } from './state';

export type OutboxEntry = { seq: number; mutationId: string; entityId: string; op: SyncOp; baseVersion: number; inFlight: boolean };
export type Entity = 'note' | 'page' | 'folder';

type Raw = { seq: number; mutation_id: string; entity_id: string; payload: string; base_version: number; in_flight: number };

const TABLES: Record<Entity, string> = { note: 'notes', page: 'pages', folder: 'folders' };
const entityOf = (op: SyncOp): Entity | null => (op.op === 'prefs.set' ? null : (op.op.split('.')[0] as Entity));
const entityIdOf = (op: SyncOp): string => (op.op === 'prefs.set' ? op.key : op.id);
const isCreate = (op: SyncOp) => op.op.endsWith('.create');
const isDelete = (op: SyncOp) => op.op.endsWith('.delete');

/**
 * Local changes waiting for the server, in order. record() must run inside the transaction that
 * makes the change, so a change is never saved without its entry (or the other way round).
 */
export class Outbox {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly state: SyncState,
    private readonly now: () => number,
    private readonly newId: () => string = randomUUID,
  ) {}

  record(op: SyncOp, baseVersion: number): void {
    if (!this.state.enabled()) return;
    const entityId = entityIdOf(op);
    const waiting = this.waiting(entityId);

    if (isDelete(op)) {
      // Nothing earlier matters once the row is gone; a row the server never heard of needs no delete.
      // Only never-sent entries can go: one sent before may already be applied, so its delete must follow.
      const droppedCreate = waiting.some((e) => isCreate(e.op));
      this.sqlite.prepare('DELETE FROM outbox WHERE entity_id = ? AND sent = 0').run(entityId);
      if (droppedCreate) return;
    } else {
      // Only the latest change may absorb this one, so the order of changes to a row never shifts.
      const last = waiting[waiting.length - 1];
      const merged = last && merge(last.op, op);
      if (merged) {
        this.sqlite.prepare('UPDATE outbox SET payload = ? WHERE seq = ?').run(JSON.stringify(merged), last.seq);
        return;
      }
    }
    this.sqlite
      .prepare('INSERT INTO outbox (mutation_id, op, entity_id, payload, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.newId(), op.op, entityId, JSON.stringify(op), baseVersion, this.now());
  }

  pending(entityId?: string): OutboxEntry[] {
    const rows = (
      entityId === undefined
        ? this.sqlite.prepare('SELECT * FROM outbox ORDER BY seq').all()
        : this.sqlite.prepare('SELECT * FROM outbox WHERE entity_id = ? ORDER BY seq').all(entityId)
    ) as Raw[];
    return rows.map(toEntry);
  }

  /** The next changes to push, marked as being sent so nothing merges into them meanwhile. */
  takeBatch(max = 100): OutboxEntry[] {
    return this.sqlite.transaction(() => {
      const rows = this.sqlite.prepare('SELECT * FROM outbox WHERE in_flight = 0 ORDER BY seq LIMIT ?').all(max) as Raw[];
      // sent stays set after a failure: the server may have applied it, so its id must keep meaning this payload.
      const mark = this.sqlite.prepare('UPDATE outbox SET in_flight = 1, sent = 1 WHERE seq = ?');
      for (const r of rows) mark.run(r.seq);
      return rows.map((r) => ({ ...toEntry(r), inFlight: true }));
    })();
  }

  /** The server applied these: forget them and remember each row's new version. */
  ack(acks: { id: string; version: number }[]): void {
    this.sqlite.transaction(() => {
      const find = this.sqlite.prepare('SELECT * FROM outbox WHERE mutation_id = ?');
      const drop = this.sqlite.prepare('DELETE FROM outbox WHERE mutation_id = ?');
      for (const a of acks) {
        const row = find.get(a.id) as Raw | undefined;
        if (!row) continue;
        drop.run(a.id);
        const entity = entityOf(JSON.parse(row.payload) as SyncOp);
        if (entity) this.setRowVersion(entity, row.entity_id, a.version);
      }
    })();
  }

  /** A push failed: everything goes again next time. */
  release(): void {
    this.sqlite.prepare('UPDATE outbox SET in_flight = 0').run();
  }

  rowVersion(entity: Entity, id: string): number {
    const row = this.sqlite.prepare(`SELECT version FROM ${TABLES[entity]} WHERE id = ?`).get(id) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  setRowVersion(entity: Entity, id: string, version: number): void {
    this.sqlite.prepare(`UPDATE ${TABLES[entity]} SET version = MAX(version, ?) WHERE id = ?`).run(version, id);
  }

  /** Entries never sent: the only ones a new change may merge into or a delete may drop. */
  private waiting(entityId: string): OutboxEntry[] {
    const rows = this.sqlite.prepare('SELECT * FROM outbox WHERE entity_id = ? AND sent = 0 ORDER BY seq').all(entityId) as Raw[];
    return rows.map(toEntry);
  }
}

/** `next` folded into `prev`, or null when they must stay separate changes. */
function merge(prev: SyncOp, next: SyncOp): SyncOp | null {
  if (prev.op !== next.op) return null;
  switch (next.op) {
    case 'page.setBody':
    case 'prefs.set':
      return next; // the latest text or value is all the server needs; base_version stays the first one's
    case 'note.update':
    case 'page.update':
    case 'folder.update':
      return { ...next, fields: { ...(prev as typeof next).fields, ...next.fields } } as SyncOp;
    default:
      return null;
  }
}

function toEntry(r: Raw): OutboxEntry {
  return {
    seq: r.seq,
    mutationId: r.mutation_id,
    entityId: r.entity_id,
    op: JSON.parse(r.payload) as SyncOp,
    baseVersion: r.base_version,
    inFlight: r.in_flight === 1,
  };
}
