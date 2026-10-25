/** Pomodoro timer: 25 min focus, 5 min break, repeating. Pure: every function takes `now` (ms). */
export type Phase = 'focus' | 'break';

export const PHASE_MS: Record<Phase, number> = { focus: 25 * 60_000, break: 5 * 60_000 };

export type Pomodoro =
  | { status: 'off' }
  | { status: 'running'; phase: Phase; endsAt: number; done: number }
  | { status: 'paused'; phase: Phase; remainingMs: number; done: number };

export const OFF: Pomodoro = { status: 'off' };

export function start(now: number): Pomodoro {
  return { status: 'running', phase: 'focus', endsAt: now + PHASE_MS.focus, done: 0 };
}

export function pause(p: Pomodoro, now: number): Pomodoro {
  if (p.status !== 'running') return p;
  return { status: 'paused', phase: p.phase, remainingMs: Math.max(0, p.endsAt - now), done: p.done };
}

export function resume(p: Pomodoro, now: number): Pomodoro {
  if (p.status !== 'paused') return p;
  return { status: 'running', phase: p.phase, endsAt: now + p.remainingMs, done: p.done };
}

const other = (phase: Phase): Phase => (phase === 'focus' ? 'break' : 'focus');

/** Jump to the next phase now. Skipping a focus phase doesn't count it as done. */
export function skip(p: Pomodoro, now: number): Pomodoro {
  if (p.status === 'off') return p;
  const phase = other(p.phase);
  return { status: 'running', phase, endsAt: now + PHASE_MS[phase], done: p.done };
}

export function remainingMs(p: Pomodoro, now: number): number {
  if (p.status === 'off') return 0;
  return p.status === 'paused' ? p.remainingMs : Math.max(0, p.endsAt - now);
}

/** How far through the current phase, 0..1. */
export function progress(p: Pomodoro, now: number): number {
  if (p.status === 'off') return 0;
  return 1 - remainingMs(p, now) / PHASE_MS[p.phase];
}

/**
 * Roll over to the next phase once the current one has run out. The next phase starts at `now`,
 * not at the old deadline, so waking from sleep starts a fresh phase instead of skipping several.
 */
export function advance(p: Pomodoro, now: number): { next: Pomodoro; ended: Phase | null } {
  if (p.status !== 'running' || now < p.endsAt) return { next: p, ended: null };
  const phase = other(p.phase);
  const done = p.phase === 'focus' ? p.done + 1 : p.done;
  return { next: { status: 'running', phase, endsAt: now + PHASE_MS[phase], done }, ended: p.phase };
}

/** m:ss, rounding up so the display reads 25:00 at the start and 0:01 in the last second. */
export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
