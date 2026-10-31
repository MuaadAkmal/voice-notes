export type GestureEvent = 'start' | 'handsfree' | 'stop' | 'discard' | 'cancel';

type State = 'idle' | 'holding' | 'tapWait' | 'secondTap' | 'handsfree' | 'stopping';

/**
 * Turns raw hotkey down/up into recording gestures.
 * Recording starts on the first key-down so no audio is lost; a short tap is
 * discarded unless a second key-down within the double-tap window makes it hands-free.
 */
export class HotkeyGesture {
  private state: State = 'idle';
  private keyIsDown = false;
  private downAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners: ((e: GestureEvent) => void)[] = [];
  private readonly holdMs: number;
  private readonly doubleTapMs: number;

  constructor(opts: { holdMs?: number; doubleTapMs?: number } = {}) {
    this.holdMs = opts.holdMs ?? 250;
    this.doubleTapMs = opts.doubleTapMs ?? 400;
  }

  onEvent(listener: (e: GestureEvent) => void): void {
    this.listeners.push(listener);
  }

  keyDown(): void {
    if (this.keyIsDown) return; // auto-repeat
    this.keyIsDown = true;
    switch (this.state) {
      case 'idle':
        this.downAt = Date.now();
        this.go('holding', 'start');
        break;
      case 'tapWait':
        this.clearTimer();
        this.go('secondTap', 'handsfree');
        break;
      case 'handsfree':
        this.go('stopping', 'stop');
        break;
    }
  }

  keyUp(): void {
    if (!this.keyIsDown) return;
    this.keyIsDown = false;
    switch (this.state) {
      case 'holding':
        if (Date.now() - this.downAt >= this.holdMs) {
          this.go('idle', 'stop');
        } else {
          this.state = 'tapWait';
          this.timer = setTimeout(() => {
            this.timer = null;
            this.go('idle', 'discard');
          }, this.doubleTapMs);
        }
        break;
      case 'secondTap':
        this.state = 'handsfree';
        break;
      case 'stopping':
        this.state = 'idle';
        break;
    }
  }

  escape(): void {
    if (this.state === 'idle' || this.state === 'stopping') return;
    this.clearTimer();
    this.go('idle', 'cancel');
  }

  toggle(): void {
    if (this.state === 'idle') {
      this.go('handsfree', 'start');
      this.emit('handsfree');
    } else if (this.state === 'handsfree') {
      this.go('idle', 'stop');
    }
  }

  reset(): void {
    this.clearTimer();
    this.state = 'idle';
  }

  private go(state: State, event: GestureEvent): void {
    this.state = state;
    this.emit(event);
  }

  private emit(e: GestureEvent): void {
    for (const l of this.listeners) l(e);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
