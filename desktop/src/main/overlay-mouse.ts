/**
 * The overlay is click-through unless the pill is hovered (renderer mouseenter) or a drag is over it
 * (DragWatch). Two sources, one window flag: combining them here keeps a mid-drag mouseleave from
 * making the window click-through under the drop.
 */
export class OverlayMouse {
  private hover = false;
  private drag = false;
  private ignoring = true; // the overlay starts click-through (windows.ts)

  constructor(private readonly apply: (ignore: boolean) => void) {}

  setHover(on: boolean): void {
    this.hover = on;
    this.update();
  }

  setDrag(on: boolean): void {
    this.drag = on;
    this.update();
  }

  private update(): void {
    const ignore = !(this.hover || this.drag);
    if (ignore === this.ignoring) return;
    this.ignoring = ignore;
    this.apply(ignore);
  }
}
