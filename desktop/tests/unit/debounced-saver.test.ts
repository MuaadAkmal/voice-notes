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

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

it('a failed timer save keeps the value pending and calls onError', async () => {
  const err = new Error('disk full');
  const save = vi.fn().mockRejectedValue(err);
  const onError = vi.fn();
  const s = new DebouncedSaver<string>(save, 500, onError);
  s.push('a');
  await vi.advanceTimersByTimeAsync(500);
  expect(onError).toHaveBeenCalledWith(err);
  expect(s.pending).toBe(true);
  save.mockResolvedValue(undefined);
  await s.flush();
  expect(save).toHaveBeenLastCalledWith('a');
  expect(s.pending).toBe(false);
});

it('a failed flush rejects and keeps the value, unless a newer one was pushed', async () => {
  const d = deferred();
  const save = vi
    .fn()
    .mockReturnValueOnce(d.promise)
    .mockResolvedValue(undefined);
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  const flushed = s.flush();
  const assertion = expect(flushed).rejects.toThrow('boom');
  s.push('b');
  d.reject(new Error('boom'));
  await assertion;
  expect(s.pending).toBe(true);
  await s.flush();
  expect(save).toHaveBeenLastCalledWith('b');
});

it('a push during an in-flight save runs afterwards, never concurrently', async () => {
  const first = deferred();
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const save = vi.fn(async (v: string) => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (v === 'a') await first.promise;
    order.push(v);
    active--;
  });
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  await vi.advanceTimersByTimeAsync(500);
  s.push('b');
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(500);
  expect(order).toEqual(['a', 'b']);
  expect(maxActive).toBe(1);
});

it('flush while a save is in flight resolves only after it completes', async () => {
  const d = deferred();
  const save = vi.fn().mockReturnValue(d.promise);
  const s = new DebouncedSaver<string>(save, 500);
  s.push('a');
  await vi.advanceTimersByTimeAsync(500);
  let done = false;
  const flushed = s.flush().then(() => (done = true));
  await vi.advanceTimersByTimeAsync(100);
  expect(done).toBe(false);
  d.resolve();
  await flushed;
  expect(done).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
});
