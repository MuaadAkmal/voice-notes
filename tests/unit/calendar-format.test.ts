process.env.TZ = 'Asia/Kolkata';

import { expect, it } from 'vitest';
import { eventPhase, formatAdded, formatEventRange, formatEventTime, msUntilMidnight, todayTitle } from '../../src/shared/calendar-format';
import type { CalendarEvent } from '../../src/shared/channels';

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m).getTime();
const ev = (start: number, end: number, allDay = false): CalendarEvent => ({ id: 'e', title: 'T', start, end, allDay, link: 'l' });

it('an all-day event reads "All day"', () => {
  expect(formatEventTime(ev(at(0), at(24), true), 'en-GB')).toBe('All day');
});

it('a timed event reads start–end in the locale', () => {
  expect(formatEventTime(ev(at(9, 5), at(10, 30)), 'en-GB')).toBe('09:05–10:30');
});

it('phase: past once it has ended, now while it runs, later before', () => {
  const e = ev(at(10), at(11));
  expect(eventPhase(e, at(9, 59))).toBe('later');
  expect(eventPhase(e, at(10))).toBe('now');
  expect(eventPhase(e, at(10, 59))).toBe('now');
  expect(eventPhase(e, at(11))).toBe('past');
});

it('msUntilMidnight counts to the next local midnight', () => {
  expect(msUntilMidnight(new Date(2026, 9, 29, 23, 59, 30))).toBe(30_000);
  expect(msUntilMidnight(new Date(2026, 9, 29, 0, 0, 0))).toBe(24 * 3_600_000);
});

it('todayTitle is "Today · D Mon"', () => {
  expect(todayTitle(new Date(2026, 9, 29, 14))).toBe('Today · 29 Oct');
});

it('formatEventRange reads the day and the times', () => {
  expect(formatEventRange(ev(new Date(2026, 9, 30, 13).getTime(), new Date(2026, 9, 30, 14).getTime()), 'en-GB')).toBe('Fri 30 Oct, 13:00–14:00');
});

it('formatEventRange across midnight names both days', () => {
  expect(formatEventRange(ev(new Date(2026, 9, 30, 23).getTime(), new Date(2026, 9, 31, 1).getTime()), 'en-GB')).toBe(
    'Fri 30 Oct, 23:00 – Sat 31 Oct, 01:00',
  );
});

it('formatEventRange for all-day events uses the last day, not the exclusive end', () => {
  expect(formatEventRange(ev(new Date(2026, 9, 30).getTime(), new Date(2026, 9, 31).getTime(), true), 'en-GB')).toBe('Fri 30 Oct');
  expect(formatEventRange(ev(new Date(2026, 9, 30).getTime(), new Date(2026, 10, 2).getTime(), true), 'en-GB')).toBe(
    'Fri 30 Oct – Sun 1 Nov',
  );
});

it('formatAdded is title · when', () => {
  expect(formatAdded({ ...ev(new Date(2026, 9, 30, 13).getTime(), new Date(2026, 9, 30, 14).getTime()), title: 'Lunch' }, 'en-GB')).toBe(
    'Lunch · Fri 30 Oct, 13:00',
  );
  expect(formatAdded({ ...ev(new Date(2026, 9, 30).getTime(), new Date(2026, 9, 31).getTime(), true), title: 'Off' }, 'en-GB')).toBe('Off · Fri 30 Oct');
});
