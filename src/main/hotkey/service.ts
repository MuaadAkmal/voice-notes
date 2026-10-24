import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';
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

  constructor(private readonly gesture: HotkeyGesture) {}

  start(): void {
    uIOhook.on('keydown', this.onKeyDown);
    uIOhook.on('keyup', this.onKeyUp);
    uIOhook.start();
  }

  stop(): void {
    uIOhook.stop();
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

  private onKeyDown = (e: UiohookKeyboardEvent): void => {
    const code = canonical(e.keycode);
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

  private onKeyUp = (e: UiohookKeyboardEvent): void => {
    const code = canonical(e.keycode);
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
