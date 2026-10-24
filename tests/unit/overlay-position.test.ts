import { expect, it } from 'vitest';
import { resolveOverlayBounds } from '../../src/main/overlay-position';

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
