import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DebouncedSaver } from '../../src/shared/debounced-saver';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it('saves only the latest value after the delay', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  await vi.advanceTimersByTimeAsync(200);
  s.push('b');
  await vi.advanceTimersByTimeAsync(200);
  s.push('c');
  expect(s.pending).toBe(true);
  await vi.advanceTimersByTimeAsync(499);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('c');
  expect(s.pending).toBe(false);
});

it('flush saves immediately and the timer then does nothing', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  await s.flush();
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('a');
  expect(s.pending).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledTimes(1);
});

it('flush with nothing pending does not save', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const s = new DebouncedSaver<string>(save, 500);
  await s.flush();
  expect(save).not.toHaveBeenCalled();
});

it('cancel drops the pending value', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  s.cancel();
  expect(s.pending).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  await s.flush();
  expect(save).not.toHaveBeenCalled();
});
