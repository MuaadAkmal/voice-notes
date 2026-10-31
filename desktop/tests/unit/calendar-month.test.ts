// London moves its clocks back on 25 Oct 2026: a day built by adding 24 h would drift.
process.env.TZ = 'Europe/London';

import { expect, it } from 'vitest';
import { chipsFor, monthGrid, weekStartFor } from '../../src/shared/calendar-month';
import type { CalendarEvent } from '../../src/shared/channels';

const d = (m: number, day: number, h = 0) => new Date(2026, m, day, h);
const ev = (id: string, start: number, end: number, allDay = false): CalendarEvent => ({ id, title: id, start, end, allDay, link: 'l' });

it('monthGrid starts on the week start and has 42 days', () => {
  const mon = monthGrid(d(9, 15), 1);
  expect(mon).toHaveLength(42);
  expect(mon[0]).toEqual(d(8, 28)); // Mon 28 Sep
  expect(monthGrid(d(9, 15), 0)[0]).toEqual(d(8, 27)); // Sun 27 Sep
  expect(monthGrid(d(9, 15), 7)[0]).toEqual(d(8, 27)); // 7 is Sunday too
  expect(monthGrid(d(5, 10), 1)[0]).toEqual(d(5, 1)); // June 2026 starts on a Monday
});

it('monthGrid builds local midnights across a DST change', () => {
  const grid = monthGrid(d(9, 1), 1);
  for (const [i, day] of grid.entries()) {
    expect(day.getHours(), day.toString()).toBe(0);
    if (i > 0) expect(day.getTime()).toBe(new Date(2026, 8, 28 + i).getTime());
  }
});

it('chipsFor spans a multi-day all-day event and excludes its end day', () => {
  const trip = ev('trip', d(9, 24).getTime(), d(9, 27).getTime(), true); // 24, 25, 26 Oct
  expect(chipsFor(d(9, 24), [trip])).toEqual([trip]);
  expect(chipsFor(d(9, 26), [trip])).toEqual([trip]);
  expect(chipsFor(d(9, 27), [trip])).toEqual([]);
  expect(chipsFor(d(9, 23), [trip])).toEqual([]);
});

it('chipsFor orders all-day first, then by start', () => {
  const late = ev('late', d(9, 30, 18).getTime(), d(9, 30, 19).getTime());
  const early = ev('early', d(9, 30, 9).getTime(), d(9, 30, 10).getTime());
  const hol = ev('hol', d(9, 30).getTime(), d(9, 31).getTime(), true);
  expect(chipsFor(d(9, 30), [late, early, hol]).map((e) => e.id)).toEqual(['hol', 'early', 'late']);
});

it('a timed event crossing midnight shows on both days', () => {
  const party = ev('party', d(9, 30, 22).getTime(), d(9, 31, 2).getTime());
  expect(chipsFor(d(9, 30), [party])).toEqual([party]);
  expect(chipsFor(d(9, 31), [party])).toEqual([party]);
  expect(chipsFor(d(10, 1), [party])).toEqual([]);
});

it('a zero-length event shows on its day', () => {
  const ping = ev('ping', d(9, 30, 9).getTime(), d(9, 30, 9).getTime());
  expect(chipsFor(d(9, 30), [ping])).toEqual([ping]);
});

it('weekStartFor reads the locale, falling back to Monday', () => {
  expect(weekStartFor('en-US')).toBe(0);
  expect(weekStartFor('en-GB')).toBe(1);
  expect(weekStartFor('not a locale!')).toBe(1);
});
