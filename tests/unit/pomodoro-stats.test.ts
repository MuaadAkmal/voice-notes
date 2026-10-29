import { expect, it } from 'vitest';
import { pomodoroStats } from '../../src/shared/pomodoro-stats';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const s = (ms: number, min = 25) => ({ completedAt: ms, focusMs: min * 60_000 });
const NOW = at(2026, 10, 29, 15);

it('is all zeros with no sessions', () => {
  const st = pomodoroStats([], NOW);
  expect(st.today).toEqual({ count: 0, minutes: 0 });
  expect(st.total).toEqual({ count: 0, minutes: 0 });
  expect(st.streak).toBe(0);
  expect(st.days.map((d) => d.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

it('sums today, the last 7 days and all time by local day', () => {
  const st = pomodoroStats([s(at(2026, 10, 1)), s(at(2026, 10, 24, 9)), s(at(2026, 10, 28), 50), s(at(2026, 10, 29, 0)), s(at(2026, 10, 29, 14))], NOW);
  expect(st.today).toEqual({ count: 2, minutes: 50 });
  expect(st.week).toEqual({ count: 4, minutes: 125 }); // 23 Oct is out, 24 Oct is in
  expect(st.total).toEqual({ count: 5, minutes: 150 });
  expect(st.days.map((d) => d.count)).toEqual([0, 1, 0, 0, 0, 1, 2]);
  expect(st.days[6].start).toBe(at(2026, 10, 29, 0));
});

it('counts the streak back from today, or from yesterday before today has a session', () => {
  const run = [s(at(2026, 10, 26)), s(at(2026, 10, 27)), s(at(2026, 10, 28))];
  expect(pomodoroStats(run, NOW).streak).toBe(3);
  expect(pomodoroStats([...run, s(at(2026, 10, 29, 9))], NOW).streak).toBe(4);
  expect(pomodoroStats([s(at(2026, 10, 27))], NOW).streak).toBe(0); // a gap yesterday breaks it
});
