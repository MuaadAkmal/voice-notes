import type { CalendarEvent } from './channels';

// How the calendar card and tab show times; pure so it is unit-tested.

/** "All day", or "09:05–10:30" in the user's locale. */
export function formatEventTime(e: CalendarEvent, locale?: string): string {
  if (e.allDay) return 'All day';
  const t = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${t(e.start)}–${t(e.end)}`;
}

/** An event is past once it has ended (end is exclusive). */
export function eventPhase(e: CalendarEvent, now: number): 'past' | 'now' | 'later' {
  if (now >= e.end) return 'past';
  return now >= e.start ? 'now' : 'later';
}

export function msUntilMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/** "Today · 29 Oct". */
export function todayTitle(now: Date): string {
  return `Today · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

const dayLabel = (ms: number, locale?: string) =>
  new Date(ms).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const timeLabel = (ms: number, locale?: string) => new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/** The last day an all-day event covers: the day before its exclusive end. */
const lastDay = (e: CalendarEvent) => {
  const end = new Date(e.end);
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1).getTime();
};

/** "Fri 30 Oct, 13:00–14:00"; across midnight "Fri 30 Oct, 23:00 – Sat 31 Oct, 01:00"; all day "Fri 30 Oct" or "Fri 30 Oct – Sun 1 Nov". */
export function formatEventRange(e: CalendarEvent, locale?: string): string {
  if (e.allDay) {
    const last = Math.max(e.start, lastDay(e));
    const first = dayLabel(e.start, locale);
    return last > e.start ? `${first} – ${dayLabel(last, locale)}` : first;
  }
  const sameDay = new Date(e.start).toDateString() === new Date(e.end).toDateString();
  if (sameDay) return `${dayLabel(e.start, locale)}, ${timeLabel(e.start, locale)}–${timeLabel(e.end, locale)}`;
  return `${dayLabel(e.start, locale)}, ${timeLabel(e.start, locale)} – ${dayLabel(e.end, locale)}, ${timeLabel(e.end, locale)}`;
}

/** The toast after adding: "Lunch · Fri 30 Oct, 13:00" (all day: "Off · Fri 30 Oct"). */
export function formatAdded(e: CalendarEvent, locale?: string): string {
  const when = e.allDay ? dayLabel(e.start, locale) : `${dayLabel(e.start, locale)}, ${timeLabel(e.start, locale)}`;
  return `${e.title} · ${when}`;
}
