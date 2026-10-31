import type { Reminder } from '../../shared/channels';
import type { RemindRequest, RemindResponse } from '../../shared/commands/protocol';
import { parseReminder } from '../../shared/reminder-command';
import type { ReminderStore } from '../store/reminder-store';

// Voice reminders, app side: the time is read here when it can be, else the `commands` function is
// asked. Stored on this PC (never synced) for the scheduler; with Google Calendar connected the event
// also goes to the account, with a popup at the time, so the phone rings too.

export const SNOOZE_MS = 10 * 60_000;
const EVENT_MS = 15 * 60_000;

export type RemindersDeps = {
  store: ReminderStore;
  now(): number;
  remind(req: RemindRequest): Promise<RemindResponse>;
  /** Files the command in the Quick notes page (no time understood, or the server couldn't be asked). */
  toQuickNotes(text: string): void;
  google: {
    connected(): boolean;
    /** The new event's id. */
    create(text: string, dueAt: number): Promise<string>;
    remove(eventId: string): Promise<void>;
    move(eventId: string, start: number, end: number): Promise<void>;
  };
  changed(): void;
  /** Where failures that don't stop a reminder go (main: electron-log). */
  warn?(msg: string, err: unknown): void;
};

export type AddReminderResult = { ok: true; reminder: Reminder; message: string } | { ok: true; reminder?: undefined; message: string };

export class RemindersService {
  constructor(private readonly d: RemindersDeps) {}

  list(): Reminder[] {
    return this.d.store.list();
  }

  /** Null when `text` isn't a reminder ("remind me …"). Never throws: the command lands somewhere. */
  async add(text: string): Promise<AddReminderResult | null> {
    const now = this.d.now();
    const local = parseReminder(text, now);
    if (!local) return null;
    let task = local.text;
    let dueAt = local.dueAt;
    if (dueAt === null) {
      const r = await this.d
        .remind({ text: text.trim(), now: localIso(now), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
        .catch((err) => (this.warn('remind failed', err), null));
      if (r?.action === 'remind') {
        task = r.text;
        dueAt = Date.parse(r.dueAt);
      }
    }
    if (dueAt === null || !(dueAt > now)) {
      this.d.toQuickNotes(text.trim());
      return { ok: true, message: 'No time heard → Quick notes' };
    }
    const reminder = this.d.store.add(task, dueAt);
    let localOnly = false;
    if (this.d.google.connected()) {
      try {
        const eventId = await this.d.google.create(task, dueAt);
        this.d.store.setGoogleEventId(reminder.id, eventId);
        reminder.googleEventId = eventId;
      } catch (err) {
        this.warn('google event failed', err);
        localOnly = true;
      }
    }
    this.d.changed();
    return { ok: true, reminder, message: `Reminder · ${task} · ${whenText(dueAt, now)}${localOnly ? ' (this PC only)' : ''}` };
  }

  async snooze(id: string): Promise<void> {
    const until = this.d.now() + SNOOZE_MS;
    this.d.store.snooze(id, until);
    await this.moveEvent(id, until);
    this.d.changed();
  }

  async update(id: string, patch: { text?: string; dueAt?: number }): Promise<void> {
    this.d.store.update(id, patch);
    if (patch.dueAt !== undefined) await this.moveEvent(id, patch.dueAt);
    this.d.changed();
  }

  async done(id: string): Promise<void> {
    this.d.store.setStatus(id, 'done');
    this.d.changed();
  }

  async cancel(id: string): Promise<void> {
    const r = this.d.store.get(id);
    this.d.store.setStatus(id, 'cancelled');
    this.d.changed();
    if (r?.googleEventId) await this.google(() => this.d.google.remove(r.googleEventId!));
  }

  private async moveEvent(id: string, start: number): Promise<void> {
    const eventId = this.d.store.get(id)?.googleEventId;
    if (eventId) await this.google(() => this.d.google.move(eventId, start, start + EVENT_MS));
  }

  /** Best effort: the reminder on this PC is what counts. */
  private async google(fn: () => Promise<void>): Promise<void> {
    if (!this.d.google.connected()) return;
    await fn().catch((err) => this.warn('google update failed', err));
  }

  private warn(msg: string, err: unknown): void {
    this.d.warn?.(`[reminders] ${msg}`, err instanceof Error ? err.message : err);
  }
}

export const REMINDER_EVENT_MS = EVENT_MS;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5:40 PM" today, "Tomorrow 7:00 PM", else "Fri 6 Nov, 3:00 PM". */
export function whenText(at: number, now: number): string {
  const t = new Date(at);
  const h = t.getHours() % 12 || 12;
  const time = `${h}:${String(t.getMinutes()).padStart(2, '0')} ${t.getHours() < 12 ? 'AM' : 'PM'}`;
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(at) === day(now)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(at) === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${DAYS[t.getDay()]} ${t.getDate()} ${MONTHS[t.getMonth()]}, ${time}`;
}

/** ISO 8601 with this PC's offset, so the server reads the user's own clock. */
function localIso(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
