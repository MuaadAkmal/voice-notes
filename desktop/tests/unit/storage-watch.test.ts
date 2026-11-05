import { expect, it } from 'vitest';
import { StorageWatch } from '../../src/main/sync/storage-watch';

const MB = 1024 * 1024;
const setup = () => {
  let warned: 'low' | 'full' | null = null;
  const watch = new StorageWatch({ getSettings: () => ({ storageWarned: warned }), save: (p) => (warned = p.storageWarned) });
  return { watch, warned: () => warned };
};

it('warns once at 80%, once more when full', () => {
  const { watch, warned } = setup();
  expect(watch.observe({ used: 100 * MB, limit: 250 * MB })).toBeNull();
  expect(watch.observe({ used: 210 * MB, limit: 250 * MB })).toBe('storage-low');
  watch.shown('storage-low');
  expect(watch.observe({ used: 220 * MB, limit: 250 * MB })).toBeNull();
  expect(watch.observe({ used: 250 * MB, limit: 250 * MB })).toBe('storage-full');
  watch.shown('storage-full');
  expect(watch.observe({ used: 250 * MB, limit: 250 * MB })).toBeNull();
  expect(warned()).toBe('full');
});

it('a notice the busy pill never showed comes back with the next numbers', () => {
  const { watch } = setup();
  expect(watch.observe({ used: 210, limit: 250 })).toBe('storage-low');
  expect(watch.observe({ used: 210, limit: 250 })).toBe('storage-low');
});

it('dropping back under 80% (deleted notes, a bigger plan) warns again next time', () => {
  const { watch, warned } = setup();
  watch.shown('storage-full');
  expect(watch.observe({ used: 1 * MB, limit: 5000 * MB })).toBeNull();
  expect(warned()).toBeNull();
  expect(watch.observe({ used: 4500 * MB, limit: 5000 * MB })).toBe('storage-low');
});
