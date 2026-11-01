import { expect, it, vi } from 'vitest';
import { polishBudgetMs, polishDictation } from '../../src/main/dictation/polish';
import { cleanupOn } from '../../src/shared/transcription';

it.each([
  [null, 'cloud', true],
  [null, 'local', false],
  [null, 'server', false],
  [null, null, false],
  [true, 'local', true],
  [false, 'cloud', false],
])('cleanup set to %s with provider %s is %s', (dictationCleanup, provider, on) => {
  expect(cleanupOn({ dictationCleanup, transcription: { provider } })).toBe(on);
});

const LONG = 'this is a long enough sentence to be worth tidying up';
const signal = new AbortController().signal;

it('pastes the cleaned text', async () => {
  const polish = vi.fn(async () => ({ text: 'Tidy.' }));
  expect(await polishDictation(LONG, signal, { enabled: () => true, polish })).toBe('Tidy.');
  expect(polish).toHaveBeenCalledWith(LONG, { signal, timeoutMs: polishBudgetMs(LONG.length) });
});

it('makes no call when switched off, or for a few words', async () => {
  const polish = vi.fn(async () => ({ text: 'Tidy.' }));
  expect(await polishDictation(LONG, signal, { enabled: () => false, polish })).toBe(LONG);
  expect(await polishDictation('thanks sounds good', signal, { enabled: () => true, polish })).toBe('thanks sounds good');
  expect(polish).not.toHaveBeenCalled();
});

it('keeps the transcript when the server refused the rewrite or anything failed', async () => {
  expect(await polishDictation(LONG, signal, { enabled: () => true, polish: async () => ({ text: null }) })).toBe(LONG);
  const failing = vi.fn(async () => {
    throw new Error('offline');
  });
  expect(await polishDictation(LONG, signal, { enabled: () => true, polish: failing })).toBe(LONG);
});

it('gives longer text longer, up to a limit', () => {
  expect(polishBudgetMs(0)).toBe(1500);
  expect(polishBudgetMs(1000)).toBe(2500);
  expect(polishBudgetMs(100_000)).toBe(4000);
});
