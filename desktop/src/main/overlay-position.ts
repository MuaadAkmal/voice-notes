import type { PillPosition } from '../shared/channels';

type Rect = { x: number; y: number; width: number; height: number };
type DisplayLike = { id: number; workArea: Rect };

const MARGIN = 16;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/**
 * Where the overlay window goes: the saved spot (relative to its display's work area, kept fully
 * on screen), or bottom-centre when nothing is saved or that display is gone. With an active display
 * the pill goes there, the saved spot keeping its relative place; without one, bottom-centre means
 * the primary display.
 */
export function resolveOverlayBounds(
  saved: PillPosition | null,
  displays: DisplayLike[],
  primaryId: number,
  size: { width: number; height: number },
  activeId?: number,
): Rect {
  const display = saved && displays.find((d) => d.id === saved.displayId);
  const active = displays.find((d) => d.id === activeId);
  if (saved && display) {
    const wa = display.workArea;
    if (active && active !== display) {
      const to = active.workArea;
      return {
        x: to.x + Math.round(share(saved.x, wa.width - size.width) * (to.width - size.width)),
        y: to.y + Math.round(share(saved.y, wa.height - size.height) * (to.height - size.height)),
        ...size,
      };
    }
    return {
      x: clamp(wa.x + saved.x, wa.x, wa.x + wa.width - size.width),
      y: clamp(wa.y + saved.y, wa.y, wa.y + wa.height - size.height),
      ...size,
    };
  }
  const wa = (active ?? displays.find((d) => d.id === primaryId) ?? displays[0]).workArea;
  return {
    x: Math.round(wa.x + (wa.width - size.width) / 2),
    y: wa.y + wa.height - size.height - MARGIN,
    ...size,
  };
}

/** How far along the free space an offset sits, 0 to 1. */
const share = (offset: number, free: number) => (free > 0 ? clamp(offset / free, 0, 1) : 0);

/**
 * Decides when the pill changes display. It reacts to the foreground window's display changing, not
 * to it differing from the pill's, so a pill dragged elsewhere stays until focus moves again. A new
 * display must hold for two ticks: Alt+Tab's switcher is briefly in front on the primary display.
 */
export class MonitorFollower {
  private current: number | null = null;
  private pending: number | null = null;

  /** The display to move to now, or null. While busy a change waits, and happens once it's over. */
  tick(displayId: number, busy: boolean): number | null {
    if (displayId === this.current) {
      this.pending = null;
      return null;
    }
    if (displayId !== this.pending) {
      this.pending = displayId;
      return null;
    }
    if (busy) return null;
    this.settle(displayId);
    return displayId;
  }

  /** The foreground window is on this display and the pill needs no move for it (after a drag). */
  settle(displayId: number | null): void {
    this.current = displayId;
    this.pending = null;
  }
}
