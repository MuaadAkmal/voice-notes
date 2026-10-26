import { useEffect, useRef, useState } from 'react';
import { isDroppable, MAX_DROP_FIELD } from '../../shared/later';

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
    const takes = (e: DragEvent) => acceptingRef.current && isDroppable(e.dataTransfer?.types ?? []);
    const onEnter = (e: DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      if (depth++ === 0) show('over');
    };
    const onOver = (e: DragEvent) => {
      if (takes(e)) e.preventDefault();
    };
    const onLeave = () => {
      if (depth > 0 && --depth === 0) show('none');
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      if (!takes(e)) return;
      e.preventDefault();
      const get = (type: string) => e.dataTransfer!.getData(type).slice(0, MAX_DROP_FIELD);
      window.overlayApi
        .dropLater({ text: get('text/plain'), uriList: get('text/uri-list'), html: get('text/html') })
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
