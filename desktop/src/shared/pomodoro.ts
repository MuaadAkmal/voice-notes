/** Pomodoro timer: focus, then a break (a long one every few sessions), repeating. Pure: every function takes `now` (ms). */
import type { PomodoroSettings } from './channels';

export type Phase = 'focus' | 'break';

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: true,
  sound: true,
  dailyGoal: 8,
};

/** long: a long break (only meaningful for a break). durationMs: the phase's full length, fixed when it began. */
type Current = { phase: Phase; long: boolean; durationMs: number; done: number };
export type Pomodoro =
  | { status: 'off' }
  | (Current & { status: 'running'; endsAt: number })
  | (Current & { status: 'paused'; remainingMs: number });

export const OFF: Pomodoro = { status: 'off' };

const MIN = 60_000;

export function phaseMs(cfg: PomodoroSettings, phase: Phase, long: boolean): number {
  return (phase === 'focus' ? cfg.focusMin : long ? cfg.longBreakMin : cfg.shortBreakMin) * MIN;
}

/** A phase beginning at `now`: running, or waiting at full length when that phase doesn't auto-start. */
function begin(phase: Phase, long: boolean, done: number, now: number, autoStart: boolean, cfg: PomodoroSettings): Pomodoro {
  const durationMs = phaseMs(cfg, phase, long);
  return autoStart
    ? { status: 'running', phase, long, durationMs, endsAt: now + durationMs, done }
    : { status: 'paused', phase, long, durationMs, remainingMs: durationMs, done };
}

export function start(now: number, cfg: PomodoroSettings): Pomodoro {
  return begin('focus', false, 0, now, true, cfg);
}

export function pause(p: Pomodoro, now: number): Pomodoro {
  if (p.status !== 'running') return p;
  const { endsAt: _, status: __, ...rest } = p;
  return { ...rest, status: 'paused', remainingMs: Math.max(0, p.endsAt - now) };
}

export function resume(p: Pomodoro, now: number): Pomodoro {
  if (p.status !== 'paused') return p;
  const { remainingMs: _, status: __, ...rest } = p;
  return { ...rest, status: 'running', endsAt: now + p.remainingMs };
}

/** What follows the current phase, given how many focus sessions are done by then. */
function next(p: Exclude<Pomodoro, { status: 'off' }>, done: number, now: number, cfg: PomodoroSettings): Pomodoro {
  if (p.phase === 'break') return begin('focus', false, done, now, cfg.autoStartFocus, cfg);
  const long = done > 0 && done % cfg.longBreakEvery === 0;
  return begin('break', long, done, now, cfg.autoStartBreaks, cfg);
}

/** Jump to the other phase now, and start it. Skipping a focus phase doesn't count it as done, so its break is short. */
export function skip(p: Pomodoro, now: number, cfg: PomodoroSettings): Pomodoro {
  if (p.status === 'off') return p;
  return begin(p.phase === 'focus' ? 'break' : 'focus', false, p.done, now, true, cfg);
}

export function remainingMs(p: Pomodoro, now: number): number {
  if (p.status === 'off') return 0;
  return p.status === 'paused' ? p.remainingMs : Math.max(0, p.endsAt - now);
}

/** How far through the current phase, 0..1. */
export function progress(p: Pomodoro, now: number): number {
  if (p.status === 'off') return 0;
  return 1 - remainingMs(p, now) / p.durationMs;
}

/**
 * Roll over to the next phase once the current one has run out. The next phase starts at `now`,
 * not at the old deadline, so waking from sleep starts a fresh phase instead of skipping several.
 */
export function advance(p: Pomodoro, now: number, cfg: PomodoroSettings): { next: Pomodoro; ended: Phase | null } {
  if (p.status !== 'running' || now < p.endsAt) return { next: p, ended: null };
  const done = p.phase === 'focus' ? p.done + 1 : p.done;
  return { next: next(p, done, now, cfg), ended: p.phase };
}

export function phaseLabel(p: { phase: Phase; long: boolean }): string {
  return p.phase === 'focus' ? 'Focus' : p.long ? 'Long break' : 'Break';
}

/** m:ss, rounding up so the display reads 25:00 at the start and 0:01 in the last second. */
export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
