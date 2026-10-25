import { expect, it } from 'vitest';
import { RingBuffer } from '../../src/shared/ring-buffer';

const f = (...xs: number[]) => Float32Array.from(xs);

it('returns the most recent samples in order', () => {
  const r = new RingBuffer(5);
  r.push(f(1, 2));
  r.push(f(3));
  expect(r.size).toBe(3);
  expect([...r.latest(10)]).toEqual([1, 2, 3]);
  expect([...r.latest(2)]).toEqual([2, 3]);
});

it('overwrites the oldest samples once full, across the wrap', () => {
  const r = new RingBuffer(4);
  r.push(f(1, 2, 3));
  r.push(f(4, 5, 6));
  expect(r.size).toBe(4);
  expect([...r.latest(4)]).toEqual([3, 4, 5, 6]);
  expect([...r.latest(3)]).toEqual([4, 5, 6]);
});

it('a chunk longer than the capacity keeps only its tail', () => {
  const r = new RingBuffer(3);
  r.push(f(1, 2, 3, 4, 5));
  expect([...r.latest(3)]).toEqual([3, 4, 5]);
});

it('clear empties it', () => {
  const r = new RingBuffer(3);
  r.push(f(1, 2));
  r.clear();
  expect(r.size).toBe(0);
  expect(r.latest(3)).toHaveLength(0);
});
