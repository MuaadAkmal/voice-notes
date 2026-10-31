import { useCallback, useEffect, useRef, useState } from 'react';

export type SavePhase =
  | { kind: 'none' }
  | { kind: 'saving' }
  | { kind: 'saved'; label: string }
  | { kind: 'nothing' }
  | { kind: 'failed' };

const SAVED_MS = 2600; // long enough for the card to land and the label to be read
const NOTICE_MS = 1600;

/** The pill's Save this: main saves the window in front to Review later; the pill shows how it went. */
export function useSaveLater(): { phase: SavePhase; save: () => void } {
  const [phase, setPhase] = useState<SavePhase>({ kind: 'none' });
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (p: SavePhase, ms: number) => {
    setPhase(p);
    timer.current = setTimeout(() => {
      busy.current = false;
      setPhase({ kind: 'none' });
    }, ms);
  };

  const save = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    setPhase({ kind: 'saving' });
    window.overlayApi
      .captureLater()
      .then((r) => (r.kind === 'saved' ? show({ kind: 'saved', label: r.label }, SAVED_MS) : show({ kind: 'nothing' }, NOTICE_MS)))
      .catch(() => show({ kind: 'failed' }, NOTICE_MS));
  }, []);

  return { phase, save };
}
