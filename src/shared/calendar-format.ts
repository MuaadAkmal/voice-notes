import type { CalendarEvent } from './channels';

// How the Today's calendar card shows times; pure so it is unit-tested.

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
