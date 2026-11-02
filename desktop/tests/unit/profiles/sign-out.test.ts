import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pendingBeforeSignOut } from '../../../src/main/profiles/sign-out';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('flushes, then counts what is still waiting', async () => {
  let left = 5;
  const flush = vi.fn(async () => void (left = 2));
  await expect(pendingBeforeSignOut({ flush, pending: () => left })).resolves.toBe(2);
  expect(flush).toHaveBeenCalledTimes(1);
});

it('a flush that fails still counts', async () => {
  await expect(pendingBeforeSignOut({ flush: async () => Promise.reject(new Error('offline')), pending: () => 3 })).resolves.toBe(3);
});

it('a flush that never settles is cut at 10 s', async () => {
  const result = pendingBeforeSignOut({ flush: () => new Promise(() => undefined), pending: () => 4 });
  let done = false;
  void result.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(9_999);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe(4);
});
