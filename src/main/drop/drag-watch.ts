// uiohook-napi event types. It has no drag type: moves with a button held arrive as MOVED.
const PRESSED = 7;
const RELEASED = 8;
const MOVED = 9;
const RELEASE_GRACE_MS = 300; // keep the overlay solid until the drop has landed

export type MouseInput = { type: number; x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type Deps = {
  accepting(): boolean;
  bounds(): Rect; // overlay window, in DIPs
  toDip(p: { x: number; y: number }): { x: number; y: number }; // the hook reports physical pixels
  setDrag(on: boolean): void;
  later(fn: () => void, ms: number): void;
};

/**
 * The click-through overlay only turns solid when the renderer reports hover, which comes too late
 * during an OS drag. This watches the global mouse instead: button held + cursor over the overlay → solid.
 */
export class DragWatch {
  private held = false;
  private over = false;

  constructor(private readonly deps: Deps) {}

  onInput(e: MouseInput): void {
    if (e.type === PRESSED) this.held = true;
    else if (e.type === RELEASED) {
      this.held = false;
      if (this.over) this.deps.later(() => this.set(false), RELEASE_GRACE_MS);
    } else if (e.type === MOVED && this.held) {
      this.set(this.deps.accepting() && this.inside(this.deps.toDip(e)));
    }
  }

  private inside({ x, y }: { x: number; y: number }): boolean {
    const b = this.deps.bounds();
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }

  private set(over: boolean): void {
    if (over === this.over) return;
    this.over = over;
    this.deps.setDrag(over);
  }
}
