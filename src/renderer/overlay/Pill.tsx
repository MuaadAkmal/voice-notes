import { useEffect, useRef, useState } from 'react';
import type { OverlayState, RecordingSource } from '../../shared/channels';
import { levelFromRms, rmsOf } from '../../shared/audio-level';

const BARS = 40;
const BAR_W = 3;
const GAP = 1.5;
const WAVE_W = BARS * (BAR_W + GAP) - GAP;
const WAVE_H = 24;
const SAMPLE_MS = 50;
const SOURCE_COLOR: Record<RecordingSource, string> = { mic: '#f87171', system: '#38bdf8', both: '#a78bfa' };

/** Scrolling voice-memo waveform: one loudness sample every 50 ms, newest bar on the right. */
function Waveform({ analyser, source }: { analyser: AnalyserNode | null; source: RecordingSource }) {
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
    const sample = setInterval(() => {
      if (!analyser || !samples) return;
      analyser.getFloatTimeDomainData(samples);
      history.shift();
      history.push(levelFromRms(rmsOf(samples)));
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
  }, [analyser, source]);

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

export function Pill({ state, analyser }: { state: OverlayState; analyser: AnalyserNode | null }) {
  const api = window.overlayApi;
  const hover = {
    onMouseEnter: () => api.setPointerOver(true),
    onMouseLeave: () => api.setPointerOver(false),
  };
  const shell =
    'flex items-center rounded-full border border-white/15 bg-neutral-900/95 text-white shadow-lg shadow-black/30 select-none';

  switch (state.kind) {
    case 'idle':
      if (!state.visible) return null;
      return (
        <button
          {...hover}
          onClick={() => api.click()}
          title="Click or hold your hotkey to record"
          className="h-2 w-10 cursor-pointer rounded-full border border-white/20 bg-neutral-900/70 transition-all hover:h-3 hover:w-14 hover:bg-neutral-800"
        />
      );
    case 'recording':
      return (
        <div {...hover} onClick={() => api.click()} className={`${shell} h-10 cursor-pointer gap-3 px-4`}>
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <SourceGlyph source={state.source} />
          <Waveform analyser={analyser} source={state.source} />
          <Timer startedAt={state.startedAt} />
          <span className="whitespace-nowrap text-[10px] uppercase tracking-wide text-white/50">
            {state.mode === 'hold' ? 'Hold' : 'Hands-free'}
          </span>
        </div>
      );
    case 'saved':
      return <div className={`${shell} h-10 px-5 text-sm`}>{state.micOnly ? 'Saved ✓ (mic only)' : 'Saved ✓'}</div>;
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
