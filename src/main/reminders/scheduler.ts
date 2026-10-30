import type { Reminder } from '../../shared/channels';
import type { ReminderStore } from '../store/reminder-store';

export const CHECK_MS = 30_000;
/** Found this late at boot, a reminder came due while the PC was off: say so. */
export const MISSED_MS = 120_000;

export type SchedulerDeps = {
  store: Pick<ReminderStore, 'due' | 'markFired'>;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  fire(r: Reminder, missed: boolean): void;
};

/** Shows each due reminder once: at start, every 30 s, and when main calls check() (resume). */
export class ReminderScheduler {
  private handle: unknown = null;

  constructor(private readonly d: SchedulerDeps) {}

  start(): void {
    this.run(true);
    this.handle = this.d.setInterval(() => this.check(), CHECK_MS);
  }

  check(): void {
    this.run(false);
  }

  stop(): void {
    if (this.handle !== null) this.d.clearInterval(this.handle);
    this.handle = null;
  }

  private run(atStart: boolean): void {
    const now = this.d.now();
    for (const r of this.d.store.due(now)) {
      // Marked first, so a notification that throws never repeats every 30 s.
      this.d.store.markFired(r.id, now);
      this.d.fire(r, atStart && now - r.dueAt > MISSED_MS);
    }
  }
}
