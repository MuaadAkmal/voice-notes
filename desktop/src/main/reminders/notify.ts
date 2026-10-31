import { Notification } from 'electron';
import type { Reminder } from '../../shared/channels';
import { whenText } from './service';

// The Windows toast for a due reminder: Snooze 10 min / Done buttons, a click opens the Reminders tab.
// Under VOICE_NOTES_TEST=1 nothing is shown; the reminder is recorded in `fired` for Playwright.

export type ReminderActions = { snooze(): void; done(): void; open(): void };

export const fired: { id: string; text: string; missed: boolean }[] = [];
// Kept alive until closed: a garbage-collected Notification loses its click and action handlers.
const shown = new Set<Notification>();

export function showReminder(r: Reminder, missed: boolean, on: ReminderActions): void {
  if (process.env.VOICE_NOTES_TEST === '1') {
    fired.push({ id: r.id, text: r.text, missed });
    return;
  }
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: missed ? `Missed · ${whenText(r.dueAt, Date.now())}` : 'Reminder',
    body: r.text,
    actions: [
      { type: 'button', text: 'Snooze 10 min' },
      { type: 'button', text: 'Done' },
    ],
    timeoutType: 'never',
  });
  n.on('action', (e) => ((e as unknown as { actionIndex?: number }).actionIndex === 0 ? on.snooze() : on.done()));
  n.on('click', () => on.open());
  n.on('close', () => shown.delete(n));
  shown.add(n);
  n.show();
}
