import { useRef } from 'react';

const DRAG_THRESHOLD_PX = 4;

/**
 * Press and move the pill more than a few pixels to drag the overlay window; a press without
 * movement stays a normal click. The click that follows a drag is swallowed.
 */
export function useDrag() {
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const swallowClick = useRef(false);
  const api = window.overlayApi;

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      start.current = { x: e.screenX, y: e.screenY };
      last.current = { ...start.current };
      dragging.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current) return;
      if (!dragging.current && Math.hypot(e.screenX - start.current.x, e.screenY - start.current.y) > DRAG_THRESHOLD_PX) {
        dragging.current = true;
        // Capture only once it's a drag: capturing on press would retarget the click away from the pill's button.
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (!dragging.current) return;
      const dx = Math.round(e.screenX - last.current.x);
      const dy = Math.round(e.screenY - last.current.y);
      if (dx || dy) {
        api.drag(dx, dy);
        last.current = { x: last.current.x + dx, y: last.current.y + dy };
      }
    },
    onPointerUp: () => {
      if (dragging.current) {
        api.dragEnd();
        swallowClick.current = true;
      }
      start.current = null;
      dragging.current = false;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  };
}
