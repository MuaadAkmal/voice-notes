import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OverlayState } from '../../shared/channels';
import { acceptsDrops } from '../../shared/later';
import { Confetti } from './Confetti';
import { DropPill, Pill } from './Pill';
import { SaveLaterPill } from './SaveLater';
import { useDrag } from './useDrag';
import { useDropLater } from './useDropLater';
import { useFilmBuffer } from './useFilmBuffer';
import { useMorph } from './useMorph';
import { usePomodoro } from './usePomodoro';
import { useRecorder } from './useRecorder';
import { useSaveLater } from './useSaveLater';
import './overlay.css';

function Overlay() {
  const [state, setState] = useState<OverlayState>({ kind: 'idle', visible: true });
  const analyser = useRecorder();
  useFilmBuffer();
  const drag = useDrag();
  const pomo = usePomodoro(state.kind === 'recording');
  const drop = useDropLater(acceptsDrops(state));
  const later = useSaveLater();
  const pill = useRef<HTMLDivElement>(null);
  useMorph(pill);
  // A finished focus phase gets a burst of confetti.
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (pomo.ended === 'focus') setConfetti(true);
  }, [pomo.ended]);

  useEffect(() => window.overlayApi.onState(setState), []);
  // Device ids are origin-scoped, so the overlay (which records) is the one that lists them.
  useEffect(() => {
    const report = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      window.overlayApi.sendDevices(
        devices
          .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' })),
      );
    };
    report();
    navigator.mediaDevices.addEventListener('devicechange', report);
    return () => navigator.mediaDevices.removeEventListener('devicechange', report);
  }, []);
  // The element under the cursor is replaced on every state change; make the window click-through
  // again until the new pill reports mouseenter, so a vanished pill can't leave a dead click zone.
  useEffect(() => window.overlayApi.setPointerOver(false), [state.kind, drop, later.phase.kind]);

  return (
    <div className="flex h-screen w-screen items-end justify-center pb-2">
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      <div {...drag} ref={pill} className="touch-none" data-testid="pill">
        {drop !== 'none' ? (
          <DropPill phase={drop} />
        ) : later.phase.kind !== 'none' && state.kind === 'idle' ? (
          <SaveLaterPill phase={later.phase} />
        ) : (
          <Pill state={state} analyser={analyser} pomo={pomo} onSave={later.save} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Overlay />);
