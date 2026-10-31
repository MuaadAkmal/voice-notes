import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { asc } from 'drizzle-orm';
import type { PomodoroSession } from '../../shared/channels';
import { pomodoroSessions } from './schema';

/** Finished focus sessions, for the Pomodoro page's stats. Shares NoteStore's connection; this PC only. */
export class PomodoroStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly now: () => number,
  ) {}

  add(focusMs: number): void {
    this.db.insert(pomodoroSessions).values({ id: randomUUID(), completedAt: this.now(), focusMs }).run();
  }

  list(): PomodoroSession[] {
    return this.db
      .select({ completedAt: pomodoroSessions.completedAt, focusMs: pomodoroSessions.focusMs })
      .from(pomodoroSessions)
      .orderBy(asc(pomodoroSessions.completedAt))
      .all();
  }

  clear(): void {
    this.db.delete(pomodoroSessions).run();
  }
}
