import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OverlayState } from '../../shared/channels';
import { Pill } from './Pill';
import { useRecorder } from './useRecorder';
import './overlay.css';

function Overlay() {
  const [state, setState] = useState<OverlayState>({ kind: 'idle', visible: true });
  const analyser = useRecorder();

  useEffect(() => window.overlayApi.onState(setState), []);
  // The element under the cursor is replaced on every state change; make the window click-through
  // again until the new pill reports mouseenter, so a vanished pill can't leave a dead click zone.
  useEffect(() => window.overlayApi.setPointerOver(false), [state.kind]);

  return (
    <div className="flex h-screen w-screen items-end justify-center pb-2">
      <Pill state={state} analyser={analyser} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Overlay />);
