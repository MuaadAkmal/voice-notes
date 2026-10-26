import { useEffect, useRef, useState } from 'react';

export type DropPhase = 'none' | 'over' | 'saved' | 'failed';
const CONFIRM_MS = 1500;

/**
 * Links and text dragged onto the pill go to the Review later page. Only while `accepting`: otherwise
 * dragover isn't cancelled, so the cursor shows "not allowed" and nothing is taken.
 */
export function useDropLater(accepting: boolean): DropPhase {
  const [phase, setPhase] = useState<DropPhase>('none');
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;

  useEffect(() => {
    let depth = 0; // dragenter/dragleave fire per element crossed; only the outermost pair counts
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (p: DropPhase, ms?: number) => {
      clearTimeout(timer);
      setPhase(p);
      if (ms) timer = setTimeout(() => setPhase('none'), ms);
    };
    const onEnter = (e: DragEvent) => {
      if (!acceptingRef.current) return;
      e.preventDefault();
      if (depth++ === 0) show('over');
    };
    const onOver = (e: DragEvent) => {
      if (acceptingRef.current) e.preventDefault();
    };
    const onLeave = () => {
      if (depth > 0 && --depth === 0) show('none');
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      if (!acceptingRef.current || !e.dataTransfer) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      window.overlayApi
        .dropLater({ text: dt.getData('text/plain'), uriList: dt.getData('text/uri-list'), html: dt.getData('text/html') })
        .then((r) => (r === 'saved' ? show('saved', CONFIRM_MS) : show('none')))
        .catch(() => show('failed', CONFIRM_MS));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // A recording that starts mid-drag ends the drop target.
  useEffect(() => {
    if (!accepting) setPhase((p) => (p === 'over' ? 'none' : p));
  }, [accepting]);

  return phase;
}
