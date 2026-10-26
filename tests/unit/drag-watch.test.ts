import { beforeEach, expect, it } from 'vitest';
import { DragWatch } from '../../src/main/drop/drag-watch';

const PRESS = 7;
const RELEASE = 8;
const MOVE = 9;
const BOUNDS = { x: 608, y: 720, width: 320, height: 80 };

let calls: boolean[];
let pending: (() => void)[];
let delays: number[];
let accepting: boolean;
let watch: DragWatch;
const input = (type: number, x = 0, y = 0) => watch.onInput({ type, x, y });

beforeEach(() => {
  calls = [];
  pending = [];
  delays = [];
  accepting = true;
  watch = new DragWatch({
    accepting: () => accepting,
    bounds: () => BOUNDS,
    toDip: ({ x, y }) => ({ x: x / 1.25, y: y / 1.25 }), // a 125% display: the hook reports physical pixels
    setDrag: (on) => calls.push(on),
    later: (fn, ms) => {
      pending.push(fn);
      delays.push(ms);
    },
  });
});

it('turns solid while a held drag is over the overlay, and back when it leaves', () => {
  input(PRESS, 100, 100);
  input(MOVE, 960, 970); // (768, 776) in DIPs: inside
  expect(calls).toEqual([true]);
  input(MOVE, 100, 100);
  expect(calls).toEqual([true, false]);
});

it('ignores moves while no button is held', () => {
  input(MOVE, 960, 970);
  expect(calls).toEqual([]);
});

it('stays solid until 300 ms after the release, so the drop lands', () => {
  input(PRESS);
  input(MOVE, 960, 970);
  input(RELEASE, 960, 970);
  expect(calls).toEqual([true]);
  expect(delays).toEqual([300]);
  pending.forEach((fn) => fn());
  expect(calls).toEqual([true, false]);
  input(MOVE, 960, 970); // released: no longer dragging
  expect(calls).toEqual([true, false]);
});

it('never turns solid while the pill is not accepting drops', () => {
  accepting = false;
  input(PRESS);
  input(MOVE, 960, 970);
  expect(calls).toEqual([]);
});
