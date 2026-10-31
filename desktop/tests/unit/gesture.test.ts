import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type GestureEvent, HotkeyGesture } from '../../src/main/hotkey/gesture';

let g: HotkeyGesture;
let events: GestureEvent[];
const wait = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
  g = new HotkeyGesture();
  events = [];
  g.onEvent((e) => events.push(e));
});
afterEach(() => vi.useRealTimers());

it('hold ≥250ms then release → start, stop', () => {
  g.keyDown();
  wait(300);
  g.keyUp();
  expect(events).toEqual(['start', 'stop']);
});

it('short tap with no follow-up → start, discard', () => {
  g.keyDown();
  wait(100);
  g.keyUp();
  wait(401);
  expect(events).toEqual(['start', 'discard']);
});

it('double tap → start, handsfree; next tap → stop', () => {
  g.keyDown();
  wait(100);
  g.keyUp();
  wait(200);
  g.keyDown();
  wait(50);
  g.keyUp();
  wait(3000);
  g.keyDown();
  g.keyUp();
  expect(events).toEqual(['start', 'handsfree', 'stop']);
});

it('second tap after 400ms is a new start', () => {
  g.keyDown();
  wait(100);
  g.keyUp();
  wait(450);
  g.keyDown();
  expect(events).toEqual(['start', 'discard', 'start']);
});

it('escape while holding → cancel', () => {
  g.keyDown();
  wait(500);
  g.escape();
  g.keyUp();
  expect(events).toEqual(['start', 'cancel']);
});

it('escape in handsfree → cancel', () => {
  g.toggle();
  g.escape();
  expect(events).toEqual(['start', 'handsfree', 'cancel']);
});

it('ignores auto-repeat keydown', () => {
  g.keyDown();
  g.keyDown();
  g.keyDown();
  wait(300);
  g.keyUp();
  expect(events).toEqual(['start', 'stop']);
});

it('toggle from idle → start, handsfree; toggle again → stop', () => {
  g.toggle();
  g.toggle();
  expect(events).toEqual(['start', 'handsfree', 'stop']);
});

it('escape when idle emits nothing', () => {
  g.escape();
  expect(events).toEqual([]);
});
