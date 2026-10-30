import type { SavePhase } from './useSaveLater';

const SHELL =
  'flex items-center justify-center rounded-full border border-white/15 bg-neutral-900/95 text-white shadow-lg shadow-black/30 select-none';

/** Round chip beside the pomodoro chip: saves the window in front to Review later. */
export function SaveThisButton({ onSave }: { onSave: () => void }) {
  return (
    <button
      aria-label="Save this window to Review later"
      title="Save this window to Review later"
      data-testid="save-this"
      onClick={(e) => {
        e.stopPropagation(); // the bar's own click starts a recording
        onSave();
      }}
      className="pomo-pop group grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-white/15 bg-neutral-900/95 text-white/75 shadow-lg shadow-black/30 transition-colors hover:border-sky-300/50 hover:text-sky-200"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-px" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" />
        <path d="M12 7.5v5M9.5 10h5" />
      </svg>
    </button>
  );
}

/**
 * The tray: a small card hovers over it while the window is read, then drops in; the tray gives,
 * a ring and three sparks go out, and a check pops on its corner. Without motion, the end state.
 */
function Tray({ landed }: { landed: boolean }) {
  return (
    <span className={`relative h-7 w-7 shrink-0 ${landed ? 'lf-landed' : 'lf-waiting'}`} aria-hidden>
      <span className="lf-ring absolute inset-0 rounded-full border border-sky-300/70" />
      <span className="lf-tray absolute inset-0">
        <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full" fill="none" stroke="rgb(255 255 255 / 0.35)" strokeWidth={1.6} strokeLinejoin="round">
          <path d="M5 14 7.6 8.5h12.8L23 14" />
        </svg>
        <span className="lf-card absolute left-[9px] top-[2px] h-3 w-2.5 rounded-[2.5px] bg-gradient-to-br from-sky-300 to-violet-400 shadow-[0_0_8px] shadow-sky-300/50">
          <span className="absolute left-[2px] right-[2px] top-[3px] h-px bg-white/80" />
          <span className="absolute left-[2px] right-[4px] top-[6px] h-px bg-white/60" />
        </span>
        <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full" strokeWidth={1.6} strokeLinejoin="round">
          <path d="M4 14h6l1.5 2.5h5L18 14h6v6.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 4 20.5Z" fill="#171717" stroke="#7dd3fc" />
        </svg>
      </span>
      {landed && (
        <>
          <span className="lf-spark lf-spark-1 absolute left-1/2 top-[11px] h-1 w-1 rounded-full bg-sky-200" />
          <span className="lf-spark lf-spark-2 absolute left-1/2 top-[11px] h-1 w-1 rounded-full bg-violet-300" />
          <span className="lf-spark lf-spark-3 absolute left-1/2 top-[11px] h-1 w-1 rounded-full bg-emerald-300" />
          <span className="lf-badge absolute -right-1 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-emerald-500 ring-2 ring-neutral-900">
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path className="lf-tick" d="M3 6.2 5 8.2 9 4" pathLength={1} />
            </svg>
          </span>
        </>
      )}
    </span>
  );
}

/** Takes the pill's place from the click until the confirmation has been seen. */
export function SaveLaterPill({ phase }: { phase: Exclude<SavePhase, { kind: 'none' }> }) {
  switch (phase.kind) {
    case 'saving':
      return (
        <div key="saving" data-morph data-testid="save-later" className={`${SHELL} h-11 gap-2.5 pl-2.5 pr-4`}>
          <Tray landed={false} />
          <span className="lf-shimmer text-[13px] font-medium">Saving for later…</span>
        </div>
      );
    case 'saved':
      return (
        <div key="saved" data-morph data-testid="save-later" className={`lf-glow ${SHELL} h-11 gap-2.5 pl-2.5 pr-4`}>
          <Tray landed />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="lf-line-1 text-[13px] font-medium">Saved to Review later</span>
            <span className="lf-line-2 max-w-[200px] truncate text-[11px] text-white/55">{phase.label}</span>
          </span>
        </div>
      );
    case 'nothing':
      return (
        <div key="nothing" data-morph className={`${SHELL} h-9 px-4 text-sm text-white/80`}>
          Nothing to save here
        </div>
      );
    case 'failed':
      return (
        <div key="failed" data-morph className={`${SHELL} h-9 bg-red-600/95 px-4 text-sm`}>
          Couldn't save
        </div>
      );
  }
}
