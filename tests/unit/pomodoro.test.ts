import { expect, it } from 'vitest';
import { advance, formatClock, OFF, PHASE_MS, pause, progress, remainingMs, resume, skip, start } from '../../src/shared/pomodoro';

it('starts with a 25 minute focus phase', () => {
  const p = start(1000);
  expect(p).toEqual({ status: 'running', phase: 'focus', endsAt: 1000 + PHASE_MS.focus, done: 0 });
  expect(remainingMs(p, 1000)).toBe(25 * 60_000);
  expect(progress(p, 1000)).toBe(0);
});

it('pausing freezes the remaining time and resuming continues it', () => {
  const p = pause(start(0), 60_000);
  expect(remainingMs(p, 999_999)).toBe(24 * 60_000);
  const r = resume(p, 500_000);
  expect(remainingMs(r, 500_000)).toBe(24 * 60_000);
  expect(progress(r, 500_000)).toBeCloseTo(1 / 25);
});

it('focus rolls into a 5 minute break and counts one pomodoro', () => {
  const p = start(0);
  expect(advance(p, PHASE_MS.focus - 1)).toEqual({ next: p, ended: null });
  const { next, ended } = advance(p, PHASE_MS.focus + 3000);
  expect(ended).toBe('focus');
  expect(next).toEqual({ status: 'running', phase: 'break', endsAt: PHASE_MS.focus + 3000 + PHASE_MS.break, done: 1 });
});

it('a break rolls back into focus without counting', () => {
  const brk = advance(start(0), PHASE_MS.focus).next;
  const { next, ended } = advance(brk, PHASE_MS.focus + PHASE_MS.break);
  expect(ended).toBe('break');
  expect(next).toMatchObject({ phase: 'focus', done: 1 });
});

it('a paused or stopped timer never advances', () => {
  const paused = pause(start(0), 10);
  expect(advance(paused, 10 ** 9).ended).toBeNull();
  expect(advance(OFF, 10 ** 9).ended).toBeNull();
});

it('skip jumps to the other phase without counting', () => {
  const s = skip(start(0), 1000);
  expect(s).toEqual({ status: 'running', phase: 'break', endsAt: 1000 + PHASE_MS.break, done: 0 });
  expect(skip(OFF, 0)).toBe(OFF);
});

it('formats the clock rounding up', () => {
  expect(formatClock(25 * 60_000)).toBe('25:00');
  expect(formatClock(61_001)).toBe('1:02');
  expect(formatClock(1)).toBe('0:01');
  expect(formatClock(0)).toBe('0:00');
});
