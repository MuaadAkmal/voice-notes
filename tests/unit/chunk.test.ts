import { expect, it } from 'vitest';
import { chunk } from '../../src/shared/format';

it('splits into batches of at most n, preserving order', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

it('returns no batches for an empty list', () => {
  expect(chunk([], 500)).toEqual([]);
});
