import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { afterPing, markPing } from '../../src/renderer/overlay/ping-gate';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('the auto-pause probe waits until the start ping has finished', async () => {
  markPing(150);
  let done = false;
  void afterPing().then(() => (done = true));
  await vi.advanceTimersByTimeAsync(149);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
});

it('without a ping it does not wait', async () => {
  await vi.advanceTimersByTimeAsync(1000); // any earlier ping is long over
  let done = false;
  void afterPing().then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toBe(true);
});
