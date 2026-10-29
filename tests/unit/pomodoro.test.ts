import { expect, it } from 'vitest';
import { advance, DEFAULT_POMODORO as CFG, formatClock, OFF, pause, phaseLabel, progress, remainingMs, resume, skip, start } from '../../src/shared/pomodoro';

const MIN = 60_000;
const FOCUS = 25 * MIN;
const BREAK = 5 * MIN;

it('starts with a 25 minute focus phase', () => {
  const p = start(1000, CFG);
  expect(p).toEqual({ status: 'running', phase: 'focus', long: false, durationMs: FOCUS, endsAt: 1000 + FOCUS, done: 0 });
  expect(remainingMs(p, 1000)).toBe(FOCUS);
  expect(progress(p, 1000)).toBe(0);
});

it('uses the configured focus length', () => {
  const p = start(0, { ...CFG, focusMin: 50 });
  expect(remainingMs(p, 0)).toBe(50 * MIN);
  expect(progress(p, 25 * MIN)).toBeCloseTo(0.5);
});

it('pausing freezes the remaining time and resuming continues it', () => {
  const p = pause(start(0, CFG), MIN);
  expect(remainingMs(p, 999_999)).toBe(24 * MIN);
  const r = resume(p, 500_000);
  expect(remainingMs(r, 500_000)).toBe(24 * MIN);
  expect(progress(r, 500_000)).toBeCloseTo(1 / 25);
});

it('focus rolls into a 5 minute break and counts one pomodoro', () => {
  const p = start(0, CFG);
  expect(advance(p, FOCUS - 1, CFG)).toEqual({ next: p, ended: null });
  const { next, ended } = advance(p, FOCUS + 3000, CFG);
  expect(ended).toBe('focus');
  expect(next).toEqual({ status: 'running', phase: 'break', long: false, durationMs: BREAK, endsAt: FOCUS + 3000 + BREAK, done: 1 });
});

it('a break rolls back into focus without counting', () => {
  const brk = advance(start(0, CFG), FOCUS, CFG).next;
  const { next, ended } = advance(brk, FOCUS + BREAK, CFG);
  expect(ended).toBe('break');
  expect(next).toMatchObject({ phase: 'focus', done: 1 });
});

it('every longBreakEvery-th break is a long one', () => {
  const cfg = { ...CFG, longBreakEvery: 2 };
  let p = start(0, cfg);
  let t = 0;
  const breaks: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    t += 60 * MIN;
    p = advance(p, t, cfg).next; // focus → break
    breaks.push(p.status !== 'off' && p.long);
    expect(phaseLabel(p as { phase: 'break'; long: boolean })).toBe(breaks[i] ? 'Long break' : 'Break');
    t += 60 * MIN;
    p = advance(p, t, cfg).next; // break → focus
  }
  expect(breaks).toEqual([false, true, false, true]);
});

it('a long break has the long length', () => {
  const cfg = { ...CFG, longBreakEvery: 2, longBreakMin: 20 };
  const p = { status: 'running' as const, phase: 'focus' as const, long: false, durationMs: FOCUS, endsAt: FOCUS, done: 1 };
  expect(advance(p, FOCUS, cfg).next).toMatchObject({ phase: 'break', long: true, durationMs: 20 * MIN, done: 2 });
});

it('without auto-start the next phase waits, paused at full length', () => {
  const cfg = { ...CFG, autoStartBreaks: false, autoStartFocus: false };
  const brk = advance(start(0, cfg), FOCUS, cfg).next;
  expect(brk).toEqual({ status: 'paused', phase: 'break', long: false, durationMs: BREAK, remainingMs: BREAK, done: 1 });
  expect(advance(brk, 10 ** 9, cfg).ended).toBeNull();
  const focus = advance(resume(brk, FOCUS), FOCUS + BREAK, cfg).next;
  expect(focus).toMatchObject({ status: 'paused', phase: 'focus', remainingMs: FOCUS });
});

it('a paused or stopped timer never advances', () => {
  const paused = pause(start(0, CFG), 10);
  expect(advance(paused, 10 ** 9, CFG).ended).toBeNull();
  expect(advance(OFF, 10 ** 9, CFG).ended).toBeNull();
});

it('skip jumps to the other phase without counting, and starts it', () => {
  const s = skip(start(0, CFG), 1000, CFG);
  expect(s).toEqual({ status: 'running', phase: 'break', long: false, durationMs: BREAK, endsAt: 1000 + BREAK, done: 0 });
  const waiting = advance(start(0, { ...CFG, autoStartFocus: false }), FOCUS, CFG).next;
  expect(skip(waiting, 0, { ...CFG, autoStartFocus: false })).toMatchObject({ status: 'running', phase: 'focus', done: 1 });
  expect(skip(OFF, 0, CFG)).toBe(OFF);
});

it('formats the clock rounding up', () => {
  expect(formatClock(25 * MIN)).toBe('25:00');
  expect(formatClock(61_001)).toBe('1:02');
  expect(formatClock(1)).toBe('0:01');
  expect(formatClock(0)).toBe('0:00');
});
