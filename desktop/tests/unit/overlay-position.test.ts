import { expect, it } from 'vitest';
import { MonitorFollower, resolveOverlayBounds } from '../../src/main/overlay-position';

const size = { width: 320, height: 80 };
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const second = { id: 2, workArea: { x: 1920, y: 0, width: 1280, height: 984 } };
const displays = [primary, second];

it('defaults to bottom-centre of the primary work area', () => {
  expect(resolveOverlayBounds(null, displays, 1, size)).toEqual({ x: 800, y: 944, ...size });
});

it('falls back to bottom-centre when the saved display is gone', () => {
  expect(resolveOverlayBounds({ displayId: 99, x: 10, y: 10 }, displays, 1, size)).toEqual({ x: 800, y: 944, ...size });
});

it('places a saved spot relative to its display work area', () => {
  expect(resolveOverlayBounds({ displayId: 2, x: 100, y: 200 }, displays, 1, size)).toEqual({
    x: 2020,
    y: 200,
    ...size,
  });
});

it('clamps a saved spot fully inside the work area on every edge', () => {
  expect(resolveOverlayBounds({ displayId: 1, x: 5000, y: 5000 }, displays, 1, size)).toEqual({
    x: 1600,
    y: 960,
    ...size,
  });
  expect(resolveOverlayBounds({ displayId: 1, x: -50, y: -50 }, displays, 1, size)).toEqual({ x: 0, y: 0, ...size });
});

it('defaults to bottom-centre of the active display when one is given', () => {
  expect(resolveOverlayBounds(null, displays, 1, size, 2)).toEqual({ x: 2400, y: 888, ...size });
  expect(resolveOverlayBounds({ displayId: 99, x: 10, y: 10 }, displays, 1, size, 2)).toEqual({ x: 2400, y: 888, ...size });
});

it('keeps a saved spot in its relative place on another display', () => {
  // Bottom-centre of the primary (x 800 of 1600 free, y 944 of 960) on a smaller display.
  expect(resolveOverlayBounds({ displayId: 1, x: 800, y: 944 }, displays, 1, size, 2)).toEqual({
    x: 1920 + 480,
    y: 889,
    ...size,
  });
  // The far corner stays the far corner, and an offset past it stays on screen.
  expect(resolveOverlayBounds({ displayId: 1, x: 5000, y: 5000 }, displays, 1, size, 2)).toEqual({
    x: 1920 + 960,
    y: 904,
    ...size,
  });
});

it('uses the exact saved spot on its own display, and when the active display is unknown', () => {
  const saved = { displayId: 2, x: 100, y: 200 };
  const expected = { x: 2020, y: 200, ...size };
  expect(resolveOverlayBounds(saved, displays, 1, size, 2)).toEqual(expected);
  expect(resolveOverlayBounds(saved, displays, 1, size, 99)).toEqual(expected);
});

const moved = (f: MonitorFollower, id: number, busy = false) => [f.tick(id, busy), f.tick(id, busy)];

it('follower moves once a new display holds for two ticks, and only once', () => {
  const f = new MonitorFollower();
  expect(moved(f, 1)).toEqual([null, 1]);
  expect(f.tick(1, false)).toBeNull();
  expect(moved(f, 2)).toEqual([null, 2]);
});

it('follower ignores a display that is in front for a single tick', () => {
  const f = new MonitorFollower();
  moved(f, 2);
  expect(f.tick(1, false)).toBeNull();
  expect(f.tick(2, false)).toBeNull();
  expect(f.tick(1, false)).toBeNull();
});

it('follower waits while busy, then moves', () => {
  const f = new MonitorFollower();
  moved(f, 1);
  expect(moved(f, 2, true)).toEqual([null, null]);
  expect(f.tick(2, true)).toBeNull();
  expect(f.tick(2, false)).toBe(2);
});

it('follower leaves a dragged pill alone until focus changes display', () => {
  const f = new MonitorFollower();
  moved(f, 1);
  f.settle(1); // dragged to display 2 while the window in front stays on display 1
  expect(moved(f, 1)).toEqual([null, null]);
  expect(moved(f, 2)).toEqual([null, 2]);
});
