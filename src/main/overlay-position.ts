import type { PillPosition } from '../shared/channels';

type Rect = { x: number; y: number; width: number; height: number };
type DisplayLike = { id: number; workArea: Rect };

const MARGIN = 16;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/**
 * Where the overlay window goes: the saved spot (relative to its display's work area, kept fully
 * on screen), or bottom-centre of the primary display when nothing is saved or that display is gone.
 */
export function resolveOverlayBounds(
  saved: PillPosition | null,
  displays: DisplayLike[],
  primaryId: number,
  size: { width: number; height: number },
): Rect {
  const display = saved && displays.find((d) => d.id === saved.displayId);
  if (saved && display) {
    const wa = display.workArea;
    return {
      x: clamp(wa.x + saved.x, wa.x, wa.x + wa.width - size.width),
      y: clamp(wa.y + saved.y, wa.y, wa.y + wa.height - size.height),
      ...size,
    };
  }
  const wa = (displays.find((d) => d.id === primaryId) ?? displays[0]).workArea;
  return {
    x: Math.round(wa.x + (wa.width - size.width) / 2),
    y: wa.y + wa.height - size.height - MARGIN,
    ...size,
  };
}
