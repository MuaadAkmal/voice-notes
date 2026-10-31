/** Completed focus sessions summed by local day, for the Pomodoro page. Pure: takes `now` (ms). */
import type { PomodoroSession } from './channels';

export type Tally = { count: number; minutes: number };
export type PomodoroStats = {
  today: Tally;
  week: Tally; // the last 7 days, today included
  total: Tally;
  /** Days in a row with at least one session, ending today (or yesterday, if today has none yet). */
  streak: number;
  /** The last 7 days, oldest first. */
  days: { start: number; count: number }[];
};

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Calendar arithmetic, so a DST change doesn't shift a day by an hour. */
const addDays = (dayStart: number, n: number) => {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export function pomodoroStats(sessions: PomodoroSession[], now: number): PomodoroStats {
  const perDay = new Map<number, Tally>();
  const total: Tally = { count: 0, minutes: 0 };
  for (const s of sessions) {
    const day = startOfDay(s.completedAt);
    const t = perDay.get(day) ?? { count: 0, minutes: 0 };
    const minutes = Math.round(s.focusMs / 60_000);
    t.count++;
    t.minutes += minutes;
    perDay.set(day, t);
    total.count++;
    total.minutes += minutes;
  }
  const today = startOfDay(now);
  const tally = (day: number): Tally => perDay.get(day) ?? { count: 0, minutes: 0 };

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((start) => ({ start, count: tally(start).count }));
  const week = days.reduce<Tally>((acc, d) => {
    const t = tally(d.start);
    return { count: acc.count + t.count, minutes: acc.minutes + t.minutes };
  }, { count: 0, minutes: 0 });

  let day = perDay.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (perDay.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return { today: tally(today), week, total, streak, days };
}
