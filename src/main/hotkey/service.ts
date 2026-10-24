import { uIOhook, UiohookKey } from 'uiohook-napi';
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

const canonical = (code: number) => CANONICAL[code] ?? code;

type KeyEvent = { keycode: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
export type KeyHook = {
  on(event: 'keydown' | 'keyup', listener: (e: KeyEvent) => void): unknown;
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

  constructor(
    private readonly gesture: HotkeyGesture,
    private readonly hook: KeyHook = uIOhook,
  ) {}

  start(): void {
    this.hook.on('keydown', this.onKeyDown);
    this.hook.on('keyup', this.onKeyUp);
    this.hook.start();
  }

  stop(): void {
    this.hook.stop();
  }

  setCombo(keycodes: number[]): void {
    this.combo = keycodes.map(canonical);
    this.comboActive = false;
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
    if (!this.comboActive && this.combo.length > 0 && this.combo.every((k) => this.pressed.has(k))) {
      this.comboActive = true;
      this.gesture.keyDown();
    }
  };

  private onKeyUp = (e: KeyEvent): void => {
    const code = canonical(e.keycode);
    this.pruneStale(e, code);
    this.pressed.delete(code);
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
