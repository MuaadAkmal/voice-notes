import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OverlayState } from '../../shared/channels';
import { acceptsDrops } from '../../shared/later';
import { toWav } from '../common/to-wav';
import { Confetti } from './Confetti';
import { DropPill, Pill } from './Pill';
import { SaveLaterPill } from './SaveLater';
import { useDrag } from './useDrag';
import { useDropLater } from './useDropLater';
import { useFilmBuffer } from './useFilmBuffer';
import { useMicTest } from './useMicTest';
import { useMorph } from './useMorph';
import { usePomodoro } from './usePomodoro';
import { useRecorder } from './useRecorder';
import { useSaveLater } from './useSaveLater';
import { useTyping } from './useTyping';
import './overlay.css';

function Overlay() {
  const [state, setState] = useState<OverlayState>({ kind: 'idle', visible: true });
  const analyser = useRecorder();
  useFilmBuffer();
  useMicTest();
  const drag = useDrag();
  const pomo = usePomodoro(state.kind === 'recording');
  const drop = useDropLater(acceptsDrops(state));
  const later = useSaveLater();
  const typing = useTyping(state.kind);
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
  // Undo → its result is done → done: count that as a change too, or the pill stays solid under the pointer.
  const undoing = state.kind === 'done' && !!state.undo;
  // The typing input opening or closing resizes the window under the pointer: the same.
  const typingOpen = typing.can !== null;
  useEffect(() => window.overlayApi.setPointerOver(false), [state.kind, undoing, drop, later.phase.kind, typingOpen]);

  return (
    <div className="flex h-screen w-screen items-end justify-center px-2 pb-2">
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {/* max-w-full: a long message shortens inside the window instead of the pill spilling past both edges */}
      <div {...drag} ref={pill} className="max-w-full touch-none" data-testid="pill">
        {drop !== 'none' ? (
          <DropPill phase={drop} />
        ) : later.phase.kind !== 'none' && state.kind === 'idle' ? (
          <SaveLaterPill phase={later.phase} />
        ) : (
          <Pill state={state} analyser={analyser} pomo={pomo} onSave={later.save} typing={typing} />
        )}
      </div>
    </div>
  );
}

// With no dashboard open (started hidden at login), main asks the pill to turn a clip into WAV.
window.overlayApi.onNeedWav(({ requestId, bytes }) =>
  toWav(bytes).then(
    (wav) => window.overlayApi.sendWav({ requestId, bytes: wav }),
    () => window.overlayApi.sendWav({ requestId, error: "Couldn't read the audio" }),
  ),
);

createRoot(document.getElementById('root')!).render(<Overlay />);
