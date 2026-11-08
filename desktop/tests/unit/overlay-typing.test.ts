import { expect, it } from 'vitest';
import { canOpenTyping } from '../../src/main/overlay-typing';

const resting = { typing: false, picking: false, pill: 'idle', recorder: 'idle', dictating: false } as const;

it('opens only on the resting pill', () => {
  expect(canOpenTyping(resting)).toBe(true);
});

it('is refused while already typing or picking a page to move to', () => {
  expect(canOpenTyping({ ...resting, typing: true })).toBe(false);
  expect(canOpenTyping({ ...resting, picking: true })).toBe(false);
});

it('is refused over a recording, a dictation, a flash or a notice', () => {
  expect(canOpenTyping({ ...resting, recorder: 'recording' })).toBe(false);
  expect(canOpenTyping({ ...resting, dictating: true })).toBe(false);
  for (const pill of ['busy', 'recording', 'saved', 'error', 'done', 'notice'] as const) expect(canOpenTyping({ ...resting, pill })).toBe(false);
});
