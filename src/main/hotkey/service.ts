import { uIOhook, UiohookKey } from 'uiohook-napi';
import type { MouseInput } from '../drop/drag-watch';
import type { HotkeyGesture } from './gesture';

// Right-hand modifiers count as their left-hand twin, so "Ctrl" matches either Ctrl key.
const CANONICAL: Record<number, number> = {
  [UiohookKey.CtrlRight]: UiohookKey.Ctrl,
  [UiohookKey.MetaRight]: UiohookKey.Meta,
  [UiohookKey.ShiftRight]: UiohookKey.Shift,
  [UiohookKey.AltRight]: UiohookKey.Alt,
};
const MODIFIER_ORDER: number[] = [UiohookKey.Ctrl, UiohookKey.Meta, UiohookKey.Alt, UiohookKey.Shift];
const NAMES: Record<number, string> = {
  ...Object.fromEntries(Object.entries(UiohookKey).map(([name, code]) => [code, name])),
  [UiohookKey.Ctrl]: 'Ctrl',
  [UiohookKey.Meta]: 'Win',
  [UiohookKey.Alt]: 'Alt',
  [UiohookKey.Shift]: 'Shift',
};
const CAPTURE_TIMEOUT_MS = 10_000;
// Media keys (play/pause, stop, prev, next). Auto-pause injects play/pause mid-hold, and its event
// carries no modifier flags: it must not prune the held hotkey or count as a combo key.
const MEDIA_KEYS = new Set([0xe022, 0xe024, 0xe010, 0xe019]);

const canonical = (code: number) => CANONICAL[code] ?? code;
// uiohook mouse pressed / released / moved (drags arrive as moved).
const MOUSE_TYPES = new Set([7, 8, 9]);

type KeyEvent = { keycode: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
export type KeyHook = {
  on(event: 'keydown' | 'keyup', listener: (e: KeyEvent) => void): unknown;
  on(event: 'input', listener: (e: { type: number; x?: number; y?: number }) => void): unknown;
  start(): void;
  stop(): void;
};

// Which event flag reports each (canonical) modifier as physically held.
const MODIFIER_FLAG: Record<number, keyof KeyEvent> = {
  [UiohookKey.Ctrl]: 'ctrlKey',
  [UiohookKey.Meta]: 'metaKey',
  [UiohookKey.Alt]: 'altKey',
  [UiohookKey.Shift]: 'shiftKey',
};

export function comboLabel(keycodes: number[]): string {
  return keycodes.map((k) => NAMES[k] ?? `Key${k}`).join('+');
}

/** Bridges the global low-level keyboard hook to a HotkeyGesture. Observes keys; never blocks them. */
export class HotkeyService {
  private combo: number[] = [];
  private pressed = new Set<number>();
  private comboActive = false;
  private paused = false;
  private capture: ((keys: number[]) => void) | null = null;
  private captureMax = new Set<number>();
  private rewindCombo: number[] = [];
  private rewindListener: (() => void) | null = null;
  /** Set when the rewind combo fires; holds off both combos until every key of them is released. */
  private rewindLatch = false;
  private mouseListener: ((e: MouseInput) => void) | null = null;

  constructor(
    private readonly gesture: HotkeyGesture,
    private readonly hook: KeyHook = uIOhook,
  ) {}

  start(): void {
    this.hook.on('keydown', this.onKeyDown);
    this.hook.on('keyup', this.onKeyUp);
    this.hook.on('input', (e) => {
      if (this.mouseListener && MOUSE_TYPES.has(e.type)) this.mouseListener({ type: e.type, x: e.x ?? 0, y: e.y ?? 0 });
    });
    this.hook.start();
  }

  /** Global mouse presses, releases and moves, for spotting a drag over the pill. Register before start(). */
  onMouse(listener: (e: MouseInput) => void): void {
    this.mouseListener = listener;
  }

  stop(): void {
    this.hook.stop();
  }

  setCombo(keycodes: number[]): void {
    this.combo = keycodes.map(canonical);
    this.comboActive = false;
  }

  /** A second combo (a superset of the main one, e.g. Alt+Win+Shift) that fires onRewind once per press. */
  setRewindCombo(keycodes: number[]): void {
    this.rewindCombo = keycodes.map(canonical);
    this.rewindLatch = false;
  }

  onRewind(listener: () => void): void {
    this.rewindListener = listener;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p && this.comboActive) {
      this.comboActive = false;
      this.gesture.keyUp();
    }
  }

  /** Resolves with the keys held at the moment the first one is released. */
  captureCombo(): Promise<{ keycodes: number[]; label: string }> {
    return new Promise((resolve, reject) => {
      this.captureMax = new Set();
      const timer = setTimeout(() => {
        this.capture = null;
        reject(new Error('Hotkey capture timed out'));
      }, CAPTURE_TIMEOUT_MS);
      this.capture = (keys) => {
        clearTimeout(timer);
        const keycodes = [
          ...MODIFIER_ORDER.filter((k) => keys.includes(k)),
          ...keys.filter((k) => !MODIFIER_ORDER.includes(k)),
        ];
        resolve({ keycodes, label: comboLabel(keycodes) });
      };
    });
  }

  /**
   * Drop modifiers the event flags say are no longer held. Their key-up can be swallowed
   * (Win+L, UAC secure desktop), which would otherwise leave them "pressed" forever.
   */
  private pruneStale(e: KeyEvent, code: number): void {
    for (const key of [...this.pressed]) {
      const flag = MODIFIER_FLAG[key];
      if (flag && key !== code && !e[flag]) this.pressed.delete(key);
    }
    if (this.comboActive && !this.combo.every((k) => k === code || this.pressed.has(k))) {
      this.comboActive = false;
      this.gesture.keyUp();
    }
  }

  private onKeyDown = (e: KeyEvent): void => {
    if (MEDIA_KEYS.has(e.keycode)) return;
    const code = canonical(e.keycode);
    this.pruneStale(e, code);
    this.pressed.add(code);
    if (this.capture) {
      this.captureMax = new Set(this.pressed);
      return;
    }
    if (this.paused) return;
    if (code === UiohookKey.Escape) {
      this.gesture.escape();
      return;
    }
    // Rewind is checked first: it contains the main combo, whose hold may already have started.
    if (!this.rewindLatch && this.rewindCombo.length > 0 && this.rewindCombo.every((k) => this.pressed.has(k))) {
      this.rewindLatch = true;
      if (this.comboActive) {
        this.comboActive = false;
        this.gesture.escape(); // discard the hold recording the first keys started
        this.gesture.keyUp(); // and let the gesture see the key as released
      }
      this.rewindListener?.();
      return;
    }
    if (this.rewindLatch) return;
    if (!this.comboActive && this.combo.length > 0 && this.combo.every((k) => this.pressed.has(k))) {
      this.comboActive = true;
      this.gesture.keyDown();
    }
  };

  private onKeyUp = (e: KeyEvent): void => {
    if (MEDIA_KEYS.has(e.keycode)) return;
    const code = canonical(e.keycode);
    this.pruneStale(e, code);
    this.pressed.delete(code);
    if (this.rewindLatch && ![...this.rewindCombo, ...this.combo].some((k) => this.pressed.has(k))) {
      this.rewindLatch = false;
    }
    if (this.capture) {
      const done = this.capture;
      this.capture = null;
      done([...this.captureMax]);
      return;
    }
    if (this.comboActive && this.combo.includes(code)) {
      this.comboActive = false;
      this.gesture.keyUp();
    }
  };
}
