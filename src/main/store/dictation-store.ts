import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { desc, eq, lt } from 'drizzle-orm';
import type { Dictation } from '../../shared/channels';
import { dictations } from './schema';

/** Recent dictation texts (no audio). Shares NoteStore's connection; pruned to the last 24 h by main. */
export class DictationStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly now: () => number,
  ) {}

  add(text: string, app: string | null): Dictation {
    const row: Dictation = { id: randomUUID(), text, app, createdAt: this.now() };
    this.db.insert(dictations).values(row).run();
    return row;
  }

  list(): Dictation[] {
    return this.db.select().from(dictations).orderBy(desc(dictations.createdAt)).all();
  }

  get(id: string): Dictation | null {
    return this.db.select().from(dictations).where(eq(dictations.id, id)).get() ?? null;
  }

  clear(): void {
    this.db.delete(dictations).run();
  }

  /** Deletes entries created more than `ms` ago; returns how many went. */
  pruneOlderThan(ms: number): number {
    return this.db.delete(dictations).where(lt(dictations.createdAt, this.now() - ms)).run().changes;
  }
}
