import type Database from 'better-sqlite3';
import type { FileKind } from '../../shared/sync/protocol';
import type { SyncState } from './state';

export type FileEntry = { kind: FileKind; name: string; attempts: number; nextAt: number; createdAt: number };

type Raw = { kind: FileKind; name: string; attempts: number; next_at: number; created_at: number };

/**
 * Audio and images waiting to upload (sync/files.ts drains it after each sync). Like the row outbox,
 * nothing is recorded while sync is off; turning it on queues what no account has seen yet.
 */
export class FileOutbox {
  /** Told after each recorded file (the controller syncs a few seconds later). */
  onRecord: (() => void) | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly state: SyncState,
    private readonly now: () => number,
  ) {}

  record(kind: FileKind, name: string): void {
    if (!this.state.enabled()) return;
    this.sqlite.prepare('INSERT OR IGNORE INTO file_outbox (kind, name, created_at) VALUES (?, ?, ?)').run(kind, name, this.now());
    try {
      this.onRecord?.();
    } catch {
      // a listener must never break a store write
    }
  }

  remove(kind: FileKind, name: string): void {
    this.sqlite.prepare('DELETE FROM file_outbox WHERE kind = ? AND name = ?').run(kind, name);
  }

  /** Entries whose time has come, oldest first. */
  due(): FileEntry[] {
    return (this.sqlite.prepare('SELECT * FROM file_outbox WHERE next_at <= ? ORDER BY created_at, rowid').all(this.now()) as Raw[]).map((r) => ({
      kind: r.kind,
      name: r.name,
      attempts: r.attempts,
      nextAt: r.next_at,
      createdAt: r.created_at,
    }));
  }

  /** Try this one again at `at`. */
  later(kind: FileKind, name: string, at: number): void {
    this.sqlite.prepare('UPDATE file_outbox SET attempts = attempts + 1, next_at = ? WHERE kind = ? AND name = ?').run(at, kind, name);
  }

  count(): number {
    return (this.sqlite.prepare('SELECT count(*) AS n FROM file_outbox').get() as { n: number }).n;
  }

  clear(): void {
    this.sqlite.prepare('DELETE FROM file_outbox').run();
  }
}
