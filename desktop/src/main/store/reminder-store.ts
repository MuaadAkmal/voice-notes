import { randomUUID } from 'node:crypto';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne } from 'drizzle-orm';
import type { Reminder, ReminderStatus } from '../../shared/channels';
import { reminders } from './schema';

const DAY = 86_400_000;

/** Voice reminders. Shares NoteStore's connection; this PC only, never synced. */
export class ReminderStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly now: () => number,
  ) {}

  add(text: string, dueAt: number): Reminder {
    const row: Reminder = { id: randomUUID(), text, dueAt, createdAt: this.now(), status: 'pending', firedAt: null, googleEventId: null };
    this.db.insert(reminders).values(row).run();
    return row;
  }

  get(id: string): Reminder | null {
    return (this.db.select().from(reminders).where(eq(reminders.id, id)).get() as Reminder | undefined) ?? null;
  }

  /** Pending soonest first, then the last 7 days of done/cancelled, latest first. */
  list(): Reminder[] {
    const pending = this.db.select().from(reminders).where(eq(reminders.status, 'pending')).orderBy(asc(reminders.dueAt)).all();
    const past = this.db
      .select()
      .from(reminders)
      .where(and(ne(reminders.status, 'pending'), gte(reminders.dueAt, this.now() - 7 * DAY)))
      .orderBy(desc(reminders.dueAt))
      .all();
    return [...pending, ...past] as Reminder[];
  }

  /** Pending reminders due by `now` whose notification hasn't been shown. */
  due(now: number): Reminder[] {
    return this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.status, 'pending'), lte(reminders.dueAt, now), isNull(reminders.firedAt)))
      .orderBy(asc(reminders.dueAt))
      .all() as Reminder[];
  }

  markFired(id: string, at: number): void {
    this.db.update(reminders).set({ firedAt: at }).where(eq(reminders.id, id)).run();
  }

  /** A new text or time; a new time shows the notification again. */
  update(id: string, patch: { text?: string; dueAt?: number }): void {
    this.db
      .update(reminders)
      .set({ ...patch, ...(patch.dueAt !== undefined ? { firedAt: null } : {}) })
      .where(eq(reminders.id, id))
      .run();
  }

  snooze(id: string, until: number): void {
    this.db.update(reminders).set({ dueAt: until, firedAt: null, status: 'pending' }).where(eq(reminders.id, id)).run();
  }

  setStatus(id: string, status: ReminderStatus): void {
    this.db.update(reminders).set({ status }).where(eq(reminders.id, id)).run();
  }

  setGoogleEventId(id: string, eventId: string | null): void {
    this.db.update(reminders).set({ googleEventId: eventId }).where(eq(reminders.id, id)).run();
  }

  /** Done and cancelled reminders older than 30 days. */
  prune(now: number): void {
    this.db
      .delete(reminders)
      .where(and(inArray(reminders.status, ['done', 'cancelled']), lt(reminders.dueAt, now - 30 * DAY)))
      .run();
  }
}
