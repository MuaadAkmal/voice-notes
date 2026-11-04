import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PillNotice } from '../../src/main/transcription/pill-notice';
import type { OverlayState } from '../../src/shared/channels';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const IDLE: OverlayState = { kind: 'idle', visible: true };
const NOV = '2026-12-01T00:00:00.000Z';

function setup(start: OverlayState = IDLE) {
  let state = start;
  const shown = vi.fn();
  const pill = new PillNotice({
    state: () => state,
    set: (s) => (state = s),
    idle: () => IDLE,
    shown,
  });
  return { pill, shown, state: () => state, setState: (s: OverlayState) => (state = s) };
}

it('shows the notice on an idle pill for 6 s, then goes back to idle', () => {
  const { pill, shown, state } = setup();
  pill.show('low', NOV);
  expect(state()).toEqual({ kind: 'notice', message: 'Cloud minutes 80% used', action: 'upgrade' });
  expect(shown).toHaveBeenCalledWith('low', NOV);
  vi.advanceTimersByTime(6000);
  expect(state()).toEqual(IDLE);
});

it('waits for a Saved pill to finish (the user may be typing its title)', () => {
  const { pill, shown, state, setState } = setup({ kind: 'saved', noteId: 'n1' });
  pill.show('out', NOV);
  expect(state()).toEqual({ kind: 'saved', noteId: 'n1' });
  expect(shown).not.toHaveBeenCalled();
  setState(IDLE);
  vi.advanceTimersByTime(500);
  expect(state()).toMatchObject({ kind: 'notice', message: 'Cloud minutes used' });
  expect(shown).toHaveBeenCalledWith('out', NOV);
});

it('gives up after 10 s of a busy pill without marking the month shown', () => {
  const { pill, shown, state } = setup({ kind: 'recording', mode: 'hold', startedAt: 0, source: 'mic' });
  pill.show('low', NOV);
  vi.advanceTimersByTime(11_000);
  expect(state().kind).toBe('recording');
  expect(shown).not.toHaveBeenCalled();
});

it('a second notice replaces the first and is not cut short by its timer', () => {
  const { pill, state } = setup();
  pill.show('low', NOV);
  vi.advanceTimersByTime(4000);
  pill.show('out', NOV);
  vi.advanceTimersByTime(3000); // the first notice's timer has fired by now
  expect(state()).toMatchObject({ message: 'Cloud minutes used' });
});
