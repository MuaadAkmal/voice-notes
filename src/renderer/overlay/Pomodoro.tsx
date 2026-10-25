import { formatClock, PHASE_MS, type Phase, progress, remainingMs } from '../../shared/pomodoro';
import type { PomodoroControls } from './usePomodoro';

/** Rose for focus, emerald for the break: used by the ring here and the idle bar's fill. */
export const PHASE_COLOR: Record<Phase, { stroke: string; bg: string; glow: string }> = {
  focus: { stroke: '#fb7185', bg: 'bg-rose-400', glow: 'shadow-rose-400/60' },
  break: { stroke: '#34d399', bg: 'bg-emerald-400', glow: 'shadow-emerald-400/60' },
};
const LABEL: Record<Phase, string> = { focus: 'Focus', break: 'Break' };
const ROUNDS = 4; // dots shown for completed focus phases, wrapping every four

const RING_R = 7;
const RING_C = 2 * Math.PI * RING_R;

/** Progress ring that fills clockwise over the phase. */
function Ring({ phase, value, paused }: { phase: Phase; value: number; paused: boolean }) {
  return (
    <svg viewBox="0 0 18 18" className={`h-[18px] w-[18px] -rotate-90 ${paused ? 'opacity-50' : ''}`} aria-hidden>
      <circle cx="9" cy="9" r={RING_R} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="2.5" />
      <circle
        cx="9"
        cy="9"
        r={RING_R}
        fill="none"
        stroke={PHASE_COLOR[phase].stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - value)}
        className="transition-[stroke-dashoffset] duration-300"
      />
    </svg>
  );
}

const ICONS = {
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  pause: 'M8 5v14M16 5v14',
  skip: 'M6 5.5v13l9-6.5-9-6.5ZM18 5v14',
  stop: 'M6.5 6.5h11v11h-11z',
};

function IconButton({ icon, label, onClick }: { icon: keyof typeof ICONS; label: string; onClick: () => void }) {
  const filled = icon !== 'pause';
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation(); // the pill's own click starts a recording
        onClick();
      }}
      className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 1 : 3} strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[icon]} />
      </svg>
    </button>
  );
}

/** Small chip above the idle bar: start a pomodoro, or see and control the running one. */
export function PomodoroChip({ pomo }: { pomo: PomodoroControls }) {
  const { timer, now, ended } = pomo;
  const shell =
    'pomo-pop flex h-8 items-center gap-2 rounded-full border border-white/15 bg-neutral-900/95 pl-2.5 pr-1 text-xs text-white shadow-lg shadow-black/30 select-none';

  if (timer.status === 'off') {
    return (
      <div className={shell} data-testid="pomodoro">
        <Ring phase="focus" value={0} paused={false} />
        <span className="text-white/70">Focus</span>
        <span className="font-mono tabular-nums text-white/90">{formatClock(PHASE_MS.focus)}</span>
        <IconButton icon="play" label="Start pomodoro" onClick={pomo.start} />
      </div>
    );
  }

  const paused = timer.status === 'paused';
  // Right after a phase ends, the chip announces the new one with a glow.
  const message = ended === 'focus' ? 'Break time' : ended === 'break' ? 'Back to focus' : LABEL[timer.phase];
  return (
    <div
      className={`${shell} ${ended ? `pomo-celebrate shadow-[0_0_18px] ${PHASE_COLOR[timer.phase].glow}` : ''}`}
      data-testid="pomodoro"
      data-phase={timer.phase}
    >
      <Ring phase={timer.phase} value={progress(timer, now)} paused={paused} />
      <span className={ended ? 'font-medium text-white' : 'text-white/70'}>{message}</span>
      <span className={`font-mono tabular-nums ${paused ? 'text-white/50' : 'text-white/90'}`}>
        {formatClock(remainingMs(timer, now))}
      </span>
      {timer.done > 0 && (
        <span className="flex gap-0.5" title={`${timer.done} pomodoro${timer.done === 1 ? '' : 's'} done`}>
          {Array.from({ length: ROUNDS }, (_, i) => (
            <span key={i} className={`h-1 w-1 rounded-full ${i < ((timer.done - 1) % ROUNDS) + 1 ? 'bg-rose-400' : 'bg-white/20'}`} />
          ))}
        </span>
      )}
      <span className="flex">
        {paused ? (
          <IconButton icon="play" label="Resume" onClick={pomo.resume} />
        ) : (
          <IconButton icon="pause" label="Pause" onClick={pomo.pause} />
        )}
        <IconButton icon="skip" label={timer.phase === 'focus' ? 'Skip to break' : 'Skip to focus'} onClick={pomo.skip} />
        <IconButton icon="stop" label="Stop pomodoro" onClick={pomo.stop} />
      </span>
    </div>
  );
}
