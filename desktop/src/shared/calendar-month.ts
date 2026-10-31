import type { CalendarEvent } from './channels';

// The Calendar tab's month grid; pure so it is unit-tested. Days are always built from calendar
// fields (never by adding 24 h), so a daylight-saving change can't push a day off midnight.

/** 6 weeks of local midnights covering `month`, starting on `weekStart` (0 = Sunday … 6 = Saturday; 7 is Sunday too). */
export function monthGrid(month: Date, weekStart: number): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const back = (first.getDay() - (weekStart % 7) + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - back + i));
}

/** The events on `day` (a local midnight): all-day first, then by start. End is exclusive; a zero-length event counts at its start. */
export function chipsFor(day: Date, events: CalendarEvent[]): CalendarEvent[] {
  const start = day.getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return events
    .filter((e) => e.start < end && (e.end > start || (e.end === e.start && e.start >= start)))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

type WeekInfoLocale = Intl.Locale & { getWeekInfo?(): { firstDay: number }; weekInfo?: { firstDay: number } };

/** The first day of the week where `locale` is used (0 = Sunday); Monday when it can't be told. */
export function weekStartFor(locale: string): number {
  try {
    const l = new Intl.Locale(locale) as WeekInfoLocale;
    const first = l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay ?? 1; // 1 = Monday … 7 = Sunday
    return first % 7;
  } catch {
    return 1;
  }
}
