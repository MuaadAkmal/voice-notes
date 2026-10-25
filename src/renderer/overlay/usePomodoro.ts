import { useCallback, useEffect, useRef, useState } from 'react';
import { advance, OFF, type Phase, type Pomodoro, pause, resume, skip, start } from '../../shared/pomodoro';

const TICK_MS = 250;
const CELEBRATE_MS = 4500;

/** Soft three-note chime: rising when focus ends (break!), falling when the break ends. */
function chime(ended: Phase): void {
  const ctx = new AudioContext();
  const notes = ended === 'focus' ? [659.25, 783.99, 1046.5] : [1046.5, 783.99, 659.25];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + i * 0.16;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1);
  });
  setTimeout(() => void ctx.close(), 2000);
}

export type PomodoroControls = {
  timer: Pomodoro;
  now: number;
  /** The phase that just ended, for a few seconds after it does (drives the celebration). */
  ended: Phase | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  stop: () => void;
};

/**
 * Lives in the overlay window, which exists for the whole session, so the timer keeps running
 * whatever the pill is showing. The chime is skipped while recording so it doesn't land in the note.
 */
export function usePomodoro(recording: boolean): PomodoroControls {
  const [timer, setTimer] = useState<Pomodoro>(OFF);
  const [now, setNow] = useState(Date.now);
  const [ended, setEnded] = useState<Phase | null>(null);
  const timerRef = useRef(timer);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const update = useCallback((fn: (p: Pomodoro, now: number) => Pomodoro) => {
    const t = Date.now();
    timerRef.current = fn(timerRef.current, t);
    setTimer(timerRef.current);
    setNow(t);
  }, []);

  useEffect(() => {
    if (timer.status !== 'running') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const step = advance(timerRef.current, t);
      if (!step.ended) return;
      timerRef.current = step.next;
      setTimer(step.next);
      setEnded(step.ended);
      if (!recordingRef.current) chime(step.ended);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [timer.status]);

  useEffect(() => {
    if (!ended) return;
    const id = setTimeout(() => setEnded(null), CELEBRATE_MS);
    return () => clearTimeout(id);
  }, [ended]);

  return {
    timer,
    now,
    ended,
    start: useCallback(() => update((_, t) => start(t)), [update]),
    pause: useCallback(() => update(pause), [update]),
    resume: useCallback(() => update(resume), [update]),
    skip: useCallback(() => update(skip), [update]),
    stop: useCallback(() => {
      setEnded(null);
      update(() => OFF);
    }, [update]),
  };
}
