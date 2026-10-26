import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('rewind combo (Alt+Win+Shift)', () => {
  const { Shift } = UiohookKey;
  const MEDIA_PLAY = 0xe022;
  let rewinds: number;
  let svc: HotkeyService;
  beforeEach(() => {
    hook = Object.assign(new EventEmitter(), { start: () => undefined, stop: () => undefined });
    calls = [];
    rewinds = 0;
    const gesture = {
      keyDown: () => calls.push('down'),
      keyUp: () => calls.push('up'),
      escape: () => calls.push('esc'),
    } as unknown as HotkeyGesture;
    svc = new HotkeyService(gesture, hook);
    svc.setCombo([Alt, Meta]);
    svc.setRewindCombo([Alt, Meta, Shift]);
    svc.onRewind(() => calls.push('rewind'));
    svc.start();
  });

  it('Shift first, then Alt+Win: rewinds without starting a recording', () => {
    down(Shift, { shiftKey: true });
    down(Alt, { shiftKey: true, altKey: true });
    down(Meta, { shiftKey: true, altKey: true, metaKey: true });
    up(Meta, { shiftKey: true, altKey: true });
    expect(calls).toEqual(['rewind']);
  });

  it('Alt+Win then Shift: the hold that just started is cancelled, then it rewinds', () => {
    down(Alt, { altKey: true });
    down(Meta, { altKey: true, metaKey: true });
    down(Shift, { altKey: true, metaKey: true, shiftKey: true });
    expect(calls).toEqual(['down', 'esc', 'up', 'rewind']);
  });

  it('fires once per press, and Alt+Win still held after releasing Shift does not start a recording', () => {
    down(Shift, { shiftKey: true });
    down(Alt, { shiftKey: true, altKey: true });
    down(Meta, { shiftKey: true, altKey: true, metaKey: true });
    down(Meta, { shiftKey: true, altKey: true, metaKey: true }); // auto-repeat
    up(Shift, { altKey: true, metaKey: true });
    down(Meta, { altKey: true, metaKey: true }); // auto-repeat
    expect(calls).toEqual(['rewind']);
    up(Meta, { altKey: true });
    up(Alt, {});
    down(Alt, { altKey: true });
    down(Meta, { altKey: true, metaKey: true });
    expect(calls).toEqual(['rewind', 'down']);
  });

  it('ignores the play/pause key auto-pause injects, even mid-hold without modifier flags', () => {
    down(Alt, { altKey: true });
    down(Meta, { altKey: true, metaKey: true });
    down(MEDIA_PLAY, {});
    up(MEDIA_PLAY, {});
    expect(calls).toEqual(['down']);
  });

  it('paused: no rewind', () => {
    svc.setPaused(true);
    down(Shift, { shiftKey: true });
    down(Alt, { shiftKey: true, altKey: true });
    down(Meta, { shiftKey: true, altKey: true, metaKey: true });
    expect(calls).toEqual([]);
  });
});

it('forwards mouse press, release and move events from the hook, not keys', () => {
  const mouseHook = Object.assign(new EventEmitter(), { start: () => undefined, stop: () => undefined });
  const service = new HotkeyService({} as HotkeyGesture, mouseHook);
  const seen: unknown[] = [];
  service.onMouse((e) => seen.push(e));
  service.start();
  mouseHook.emit('input', { type: 9, x: 1, y: 2 });
  mouseHook.emit('input', { type: 7, x: 3, y: 4 });
  mouseHook.emit('input', { type: 4, keycode: Alt }); // a key press
  mouseHook.emit('input', { type: 11, x: 0, y: 0 }); // wheel
  expect(seen).toEqual([
    { type: 9, x: 1, y: 2 },
    { type: 7, x: 3, y: 4 },
  ]);
});

describe('dictation combo (Ctrl+Win)', () => {
  const { Ctrl, Escape } = UiohookKey;
  let svc: HotkeyService;
  beforeEach(() => {
    hook = Object.assign(new EventEmitter(), { start: () => undefined, stop: () => undefined });
    calls = [];
    const gesture = {
      keyDown: () => calls.push('down'),
      keyUp: () => calls.push('up'),
      escape: () => calls.push('esc'),
    } as unknown as HotkeyGesture;
    const dictation = {
      keyDown: () => calls.push('d-down'),
      keyUp: () => calls.push('d-up'),
      escape: () => calls.push('d-esc'),
    } as unknown as HotkeyGesture;
    svc = new HotkeyService(gesture, hook);
    svc.setCombo([Alt, Meta]);
    svc.attachDictation(dictation);
    svc.setDictationCombo([Ctrl, Meta]);
    svc.start();
  });

  it('fires the dictation gesture on Ctrl+Win, not the main one', () => {
    down(Ctrl, { ctrlKey: true });
    down(Meta, { ctrlKey: true, metaKey: true });
    up(Meta, { ctrlKey: true });
    expect(calls).toEqual(['d-down', 'd-up']);
  });

  it('only one combo active: Alt+Win held, then Ctrl does not start a dictation', () => {
    down(Alt, { altKey: true });
    down(Meta, { altKey: true, metaKey: true });
    down(Ctrl, { altKey: true, metaKey: true, ctrlKey: true });
    up(Meta, { altKey: true, ctrlKey: true });
    up(Alt, { ctrlKey: true });
    up(Ctrl, {});
    expect(calls).toEqual(['down', 'up']);
  });

  it('only one combo active: Ctrl+Win held, then Alt does not start a note', () => {
    down(Ctrl, { ctrlKey: true });
    down(Meta, { ctrlKey: true, metaKey: true });
    down(Alt, { altKey: true, metaKey: true, ctrlKey: true });
    expect(calls).toEqual(['d-down']);
  });

  it('Esc reaches both gestures', () => {
    down(Escape, {});
    expect(calls).toEqual(['esc', 'd-esc']);
  });

  it('pausing releases an active dictation', () => {
    down(Ctrl, { ctrlKey: true });
    down(Meta, { ctrlKey: true, metaKey: true });
    svc.setPaused(true);
    expect(calls).toEqual(['d-down', 'd-up']);
  });

  it('a swallowed Win key-up releases the dictation', () => {
    down(Ctrl, { ctrlKey: true });
    down(Meta, { ctrlKey: true, metaKey: true });
    down(Tab, {});
    expect(calls).toEqual(['d-down', 'd-up']);
  });
});
