import { expect, it } from 'vitest';
import type { StatusMap } from '../../src/shared/channels';
import { TranscriptionQueue } from '../../src/main/transcription/queue';

/** A runner whose jobs finish only when the test says so. */
function controlledRunner() {
  const calls: { id: string; language: string | null }[] = [];
  const pending = new Map<
    string,
    { resolve: () => void; reject: (e: Error) => void }
  >();
  const run = (id: string, language: string | null) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ id, language });
      pending.set(id, { resolve, reject });
    });
  return { run, calls, pending };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

it('runs one job at a time in order and forgets finished ones', async () => {
  const r = controlledRunner();
  const changes: StatusMap[] = [];
  const q = new TranscriptionQueue(r.run, (s) => changes.push(s));
  q.enqueue(['a', 'b'], 'es');
  expect(q.status()).toEqual({
    a: { state: 'running' },
    b: { state: 'queued' },
  });
  expect(r.calls).toEqual([{ id: 'a', language: 'es' }]);
  r.pending.get('a')!.resolve();
  await tick();
  expect(q.status()).toEqual({ b: { state: 'running' } });
  r.pending.get('b')!.resolve();
  await q.idle();
  expect(q.status()).toEqual({});
  expect(r.calls.map((c) => c.id)).toEqual(['a', 'b']);
  expect(changes).toEqual([
    { a: { state: 'running' }, b: { state: 'queued' } },
    { b: { state: 'running' } },
    {},
  ]);
});

it('ignores a note that is already queued or running', async () => {
  const r = controlledRunner();
  const q = new TranscriptionQueue(r.run, () => undefined);
  q.enqueue(['a', 'b'], null);
  q.enqueue(['a', 'b'], null);
  r.pending.get('a')!.resolve();
  await tick();
  r.pending.get('b')!.resolve();
  await q.idle();
  expect(r.calls.map((c) => c.id)).toEqual(['a', 'b']);
});

it('records a failure, keeps going, and allows a retry', async () => {
  const r = controlledRunner();
  const q = new TranscriptionQueue(r.run, () => undefined);
  q.enqueue(['a', 'b'], null);
  r.pending.get('a')!.reject(new Error('boom'));
  await tick();
  expect(q.status()).toEqual({
    a: { state: 'failed', error: 'boom' },
    b: { state: 'running' },
  });
  r.pending.get('b')!.resolve();
  await q.idle();
  q.enqueue(['a'], null);
  expect(q.status()).toEqual({ a: { state: 'running' } });
  r.pending.get('a')!.resolve();
  await q.idle();
  expect(q.status()).toEqual({});
});

it('idle resolves at once when nothing is queued', async () => {
  const q = new TranscriptionQueue(
    async () => undefined,
    () => undefined,
  );
  await expect(q.idle()).resolves.toBeUndefined();
});

it('status returns a copy', () => {
  const r = controlledRunner();
  const q = new TranscriptionQueue(r.run, () => undefined);
  q.enqueue(['a'], null);
  const s = q.status();
  delete s.a;
  expect(q.status()).toEqual({ a: { state: 'running' } });
});
