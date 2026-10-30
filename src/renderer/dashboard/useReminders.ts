import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../../shared/channels';

const api = window.dashboardApi;

/** This PC's reminders, reloaded whenever main says they changed (added, fired, snoozed…). */
export function useReminders(): Reminder[] | null {
  const [list, setList] = useState<Reminder[] | null>(null);
  const load = useCallback(() => api.listReminders().then(setList), []);
  useEffect(() => {
    load();
    return api.onRemindersChanged(load);
  }, [load]);
  // "in 8 min" stays true while the page is open.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return list;
}

/** "in 8 min", "in 2 h", "Due" once shown, else nothing past a day. */
export function relative(r: Reminder, now = Date.now()): string {
  if (r.status !== 'pending') return '';
  if (r.firedAt !== null || r.dueAt <= now) return 'Due';
  const min = Math.ceil((r.dueAt - now) / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `in ${h} h` : '';
}

/** "Today 5:40 PM", "Tomorrow 9:00 AM", "Fri 6 Nov, 3:00 PM". */
export function when(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => x.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day(d) === day(new Date(now))) return `Today ${time}`;
  if (day(d) === day(tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}
