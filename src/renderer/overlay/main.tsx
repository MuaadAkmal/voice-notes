import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OverlayState } from '../../shared/channels';
import { Pill } from './Pill';
import { useDrag } from './useDrag';
import { useRecorder } from './useRecorder';
import './overlay.css';

function Overlay() {
  const [state, setState] = useState<OverlayState>({ kind: 'idle', visible: true });
  const analyser = useRecorder();
  const drag = useDrag();

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
  useEffect(() => window.overlayApi.setPointerOver(false), [state.kind]);

  return (
    <div className="flex h-screen w-screen items-end justify-center pb-2">
      <div {...drag} className="touch-none" data-testid="pill">
        <Pill state={state} analyser={analyser} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Overlay />);
