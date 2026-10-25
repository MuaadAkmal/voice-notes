import { useEffect, useRef, useState } from 'react';
import type { OverlayState, RecordingSource } from '../../shared/channels';
import { isSilent, levelFromRms, rmsOf } from '../../shared/audio-level';
import { progress } from '../../shared/pomodoro';
import { PHASE_COLOR, PomodoroChip } from './Pomodoro';
import type { PomodoroControls } from './usePomodoro';

const BARS = 28;
const BAR_W = 2.5;
const GAP = 1.5;
const WAVE_W = BARS * (BAR_W + GAP) - GAP;
const WAVE_H = 20;
const SAMPLE_MS = 50;
const SILENT_AFTER_MS = 3000;
const SOURCE_COLOR: Record<RecordingSource, string> = { mic: '#f87171', system: '#38bdf8', both: '#a78bfa' };

/** Scrolling voice-memo waveform: one loudness sample every 50 ms, newest bar on the right. */
type WaveformProps = { analyser: AnalyserNode | null; source: RecordingSource; onSilentChange: (silent: boolean) => void };

function Waveform({ analyser, source, onSilentChange }: WaveformProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = WAVE_W * dpr;
    el.height = WAVE_H * dpr;
    ctx.scale(dpr, dpr);

    const history = new Array<number>(BARS).fill(0);
    const samples = analyser ? new Float32Array(analyser.fftSize) : null;
    let quietSince = performance.now();
    let reportedSilent = false;
    const sample = setInterval(() => {
      if (!analyser || !samples) return;
      analyser.getFloatTimeDomainData(samples);
      const rms = rmsOf(samples);
      history.shift();
      history.push(levelFromRms(rms));
      // "No sound" once the input has stayed below the silence threshold for SILENT_AFTER_MS.
      const now = performance.now();
      if (!isSilent(rms)) quietSince = now;
      const silent = now - quietSince >= SILENT_AFTER_MS;
      if (silent !== reportedSilent) {
        reportedSilent = silent;
        onSilentChange(silent);
      }
    }, SAMPLE_MS);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, WAVE_W, WAVE_H);
      ctx.fillStyle = SOURCE_COLOR[source];
      history.forEach((level, i) => {
        const h = Math.max(2, level * WAVE_H);
        ctx.globalAlpha = 0.25 + 0.75 * (i / (BARS - 1)); // older bars fade out
        ctx.beginPath();
        ctx.roundRect(i * (BAR_W + GAP), (WAVE_H - h) / 2, BAR_W, h, BAR_W / 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      clearInterval(sample);
      cancelAnimationFrame(raf);
    };
  }, [analyser, source, onSilentChange]);

  return <canvas ref={canvas} style={{ width: WAVE_W, height: WAVE_H }} aria-hidden />;
}
function Timer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="w-9 text-right font-mono text-xs tabular-nums text-white/80">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

const MIC_PATH = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v2';
const SPEAKER_PATH = 'M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12';

type SavedState = Extract<OverlayState, { kind: 'saved' }>;
type Hover = { onMouseEnter: () => void; onMouseLeave: () => void };

/** "Saved ✓ · Add title": click to type the phrase or its meaning into the note's title. */
function SavedPill({ state, shell, hover }: { state: SavedState; shell: string; hover: Hover }) {
  const api = window.overlayApi;
  const [titling, setTitling] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  // The window only becomes focusable once main handles startTitle; focus the input when it does.
  useEffect(() => {
    if (!titling) return;
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [titling]);

  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    if (title?.trim()) api.submitTitle(state.noteId, title.trim());
    else api.cancelTitle();
  };

  if (titling) {
    return (
      <div {...hover} className={`${shell} h-9 gap-2 px-3`}>
        <span className="text-sm text-white/60">✓</span>
        <input
          ref={input}
          maxLength={200}
          placeholder="Phrase or meaning…"
          aria-label="Note title"
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(e.currentTarget.value);
            if (e.key === 'Escape') finish(null);
          }}
          onBlur={(e) => finish(e.currentTarget.value ? e.currentTarget.value : null)}
          className="w-52 bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
        />
      </div>
    );
  }

  return (
    <button
      {...hover}
      onClick={() => {
        done.current = false;
        setTitling(true);
        api.startTitle();
      }}
      className={`${shell} h-9 cursor-pointer gap-1.5 px-4 text-sm`}
    >
      {state.micOnly ? 'Saved ✓ (mic only)' : 'Saved ✓'}
      <span className="text-white/40">·</span>
      <span className="text-white/70 underline-offset-2 hover:underline">Add title</span>
    </button>
  );
}

/** Hands-free (latched) recording: a small lock instead of a text label, to keep the pill narrow. */
function HandsFreeGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-white/50" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="Hands-free">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Which input this clip captures: mic, system audio, or both. */
function SourceGlyph({ source }: { source: RecordingSource }) {
  const paths = source === 'mic' ? [MIC_PATH] : source === 'system' ? [SPEAKER_PATH] : [MIC_PATH, SPEAKER_PATH];
  return (
    <span className="flex items-center gap-0.5 text-white/60" title={source === 'both' ? 'Mic + system audio' : source === 'system' ? 'System audio' : 'Microphone'}>
      {paths.map((d) => (
        <svg key={d} viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d={d} />
        </svg>
      ))}
    </span>
  );
}

const CHIP_LINGER_MS = 350;

/**
 * The resting bar. Hovering it raises the pomodoro chip above it (the bar itself never moves, so a
 * click aimed at it still records); a running pomodoro fills the bar with its progress.
 */
function IdleBar({ visible, film, pomo, hover }: { visible: boolean; film: boolean; pomo: PomodoroControls; hover: Hover }) {
  const api = window.overlayApi;
  const [open, setOpen] = useState(false);
  const linger = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(linger.current), []);
  const { timer } = pomo;
  const running = timer.status !== 'off';
  // Film mode and a running pomodoro are always shown, even with the idle pill hidden.
  if (!visible && !film && !running) return null;

  const fill = running ? progress(timer, pomo.now) : 0;
  const phase = running ? timer.phase : 'focus';
  const big = open || pomo.ended !== null;
  return (
    <div
      onMouseEnter={() => {
        clearTimeout(linger.current);
        setOpen(true);
        hover.onMouseEnter();
      }}
      onMouseLeave={() => {
        hover.onMouseLeave();
        linger.current = setTimeout(() => setOpen(false), CHIP_LINGER_MS);
      }}
      className="flex flex-col items-center gap-1.5"
    >
      {(open || pomo.ended) && <PomodoroChip pomo={pomo} />}
      <div className="flex items-center gap-1.5">
        {film && (
          <span
            data-testid="film-dot"
            title="Film mode: Alt+Win+Shift saves the last few seconds"
            className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px] shadow-sky-400/70"
          />
        )}
        {(visible || running) && (
          <button
            onClick={() => api.click()}
            title="Click or hold your hotkey to record"
            className={`relative cursor-pointer overflow-hidden rounded-full border border-white/20 transition-all duration-200 ${
              big ? 'h-3 w-14 bg-neutral-800' : 'h-2 w-10 bg-neutral-900/70'
            } ${pomo.ended ? 'pomo-burst' : ''}`}
          >
            {running && (
              <span
                data-testid="pomodoro-fill"
                className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${PHASE_COLOR[phase].bg} ${
                  timer.status === 'paused' ? 'opacity-40' : 'opacity-80'
                }`}
                style={{ width: `${fill * 100}%` }}
              />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

type PillProps = { state: OverlayState; analyser: AnalyserNode | null; pomo: PomodoroControls };

export function Pill({ state, analyser, pomo }: PillProps) {
  const api = window.overlayApi;
  const [silent, setSilent] = useState(false);
  const recording = state.kind === 'recording';
  // Each recording starts out assumed audible.
  useEffect(() => {
    if (!recording) setSilent(false);
  }, [recording]);
  const hover = {
    onMouseEnter: () => api.setPointerOver(true),
    onMouseLeave: () => api.setPointerOver(false),
  };
  const shell =
    'flex items-center rounded-full border border-white/15 bg-neutral-900/95 text-white shadow-lg shadow-black/30 select-none';

  switch (state.kind) {
    case 'idle':
      return <IdleBar visible={state.visible} film={!!state.film} pomo={pomo} hover={hover} />;
    case 'busy':
      return (
        <div className={`${shell} h-9 gap-2 px-4 text-sm text-white/80`}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          {state.message}
        </div>
      );
    case 'recording':
      return (
        <div {...hover} onClick={() => api.click()} className={`group ${shell} h-9 cursor-pointer gap-2.5 px-3.5`}>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <SourceGlyph source={state.source} />
          {/* "No sound" takes the waveform's slot so the pill never grows. */}
          <div className="relative" style={{ width: WAVE_W, height: WAVE_H }}>
            <Waveform analyser={analyser} source={state.source} onSilentChange={setSilent} />
            {silent && (
              <span
                title="No sound — check mic/source"
                className="absolute inset-0 flex items-center justify-center rounded bg-neutral-900/90 text-[11px] font-medium text-amber-400"
              >
                No sound
              </span>
            )}
          </div>
          <Timer startedAt={state.startedAt} />
          {state.mode === 'handsfree' && <HandsFreeGlyph />}
          {state.mode === 'handsfree' && (
            <button
              aria-label="Discard recording"
              title="Discard recording"
              onClick={(e) => {
                e.stopPropagation(); // not a toggle (which would save)
                api.discard();
              }}
              className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-white/50 opacity-0 transition-opacity hover:bg-white/15 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
      );
    case 'saved':
      if (state.titled) return <div className={`${shell} h-9 px-4 text-sm`}>Saved ✓</div>;
      return <SavedPill state={state} shell={shell} hover={hover} />;
    case 'error':
      return state.retry ? (
        <button {...hover} onClick={() => api.retry()} className={`${shell} h-10 cursor-pointer bg-red-600/95 px-5 text-sm`}>
          {state.message}
        </button>
      ) : (
        <div className={`${shell} h-10 bg-red-600/95 px-5 text-sm`}>{state.message}</div>
      );
  }
}
