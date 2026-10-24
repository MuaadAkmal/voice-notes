import { EventEmitter } from 'node:events';
import { beforeEach, expect, it } from 'vitest';
import { UiohookKey } from 'uiohook-napi';
import type { HotkeyGesture } from '../../src/main/hotkey/gesture';
import { HotkeyService, type KeyHook } from '../../src/main/hotkey/service';

const { Alt, Meta, Tab } = UiohookKey;
type Flags = { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };

let hook: EventEmitter & KeyHook;
let calls: string[];
const down = (keycode: number, flags: Flags = {}) => hook.emit('keydown', { keycode, ...flags });
const up = (keycode: number, flags: Flags = {}) => hook.emit('keyup', { keycode, ...flags });

beforeEach(() => {
  hook = Object.assign(new EventEmitter(), { start: () => undefined, stop: () => undefined });
  calls = [];
  const gesture = {
    keyDown: () => calls.push('down'),
    keyUp: () => calls.push('up'),
    escape: () => calls.push('esc'),
  } as unknown as HotkeyGesture;
  const service = new HotkeyService(gesture, hook);
  service.setCombo([Alt, Meta]);
  service.start();
});

it('fires on Alt+Win and releases on key-up', () => {
  down(Alt, { altKey: true });
  down(Meta, { altKey: true, metaKey: true });
  up(Meta, { altKey: true });
  expect(calls).toEqual(['down', 'up']);
});

it('a stale Win (key-up swallowed by Win+L) does not make Alt alone fire', () => {
  down(Meta, { metaKey: true }); // Win+L: the key-up never arrives
  down(Alt, { altKey: true, metaKey: false });
  expect(calls).toEqual([]);
});

it('releases an active combo whose key-up was swallowed', () => {
  down(Alt, { altKey: true });
  down(Meta, { altKey: true, metaKey: true });
  down(Tab, {}); // both modifiers are physically up again
  expect(calls).toEqual(['down', 'up']);
});
