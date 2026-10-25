import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type NoteSink, type OverlayPort, RecorderController } from '../../src/main/recorder/controller';
import type { NewAudio } from '../../src/main/store/note-store';
import type { Note, NoteContext, OverlayState, RecordingSource } from '../../src/shared/ipc';

const IDLE: OverlayState = { kind: 'idle', visible: true };
let calls: string[];
let states: OverlayState[];
let created: NewAudio[];
let failNext: boolean;
let context: NoteContext | null;
let source: RecordingSource;
let captures: string[];
let c: RecorderController;
const lastState = () => states[states.length - 1];
const audio = (durationMs: number, src: RecordingSource = 'mic'): NewAudio => ({
  bytes: Buffer.from('xyz'),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
  source: src,
});

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  states = [];
  created = [];
  failNext = false;
  context = { windowTitle: 'Dark | Netflix - Google Chrome', show: 'Dark' };
  source = 'mic';
  captures = [];
  const overlay: OverlayPort = {
    start: (_d, s) => calls.push(`start:${s}`),
    stop: () => calls.push('stop'),
    cancel: () => calls.push('cancel'),
    rewind: (s) => calls.push(`rewind:${s}`),
    setState: (s) => states.push(s),
  };
  const sink: NoteSink = {
    create: async (a) => {
      created.push(a);
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      return { id: 'n1' } as Note;
    },
  };
  c = new RecorderController(overlay, sink, {
    getDeviceId: () => null,
    getSource: () => source,
    onSaved: () => undefined,
    idleState: () => IDLE,
    getContext: () => context,
    getRewindSeconds: () => 15,
    onCaptureStart: (s) => captures.push(`start:${s}`),
    onCaptureEnd: () => captures.push('end'),
  });
});
afterEach(() => vi.useRealTimers());

it('stores the window context captured when recording started', async () => {
  c.handleGesture('start');
  context = { windowTitle: 'something else', show: null }; // focus moved while recording
  c.handleGesture('stop');
  await c.onAudio(audio(1000));
  expect(created[0]).toMatchObject({ kind: 'note', windowTitle: 'Dark | Netflix - Google Chrome', show: 'Dark' });
});

it('no context available stores nulls', async () => {
  context = null;
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(1000));
  expect(created[0]).toMatchObject({ windowTitle: null, show: null });
});

it('rewind asks the overlay for the last N seconds and saves a rewind note with context', async () => {
  expect(c.rewind()).toBe(true);
  expect(calls).toEqual(['rewind:15']);
  expect(c.state).toBe('rewinding');
  expect(lastState()).toEqual({ kind: 'busy', message: 'Saving last 15 s…' });
  await c.onAudio(audio(15_000, 'system'));
  expect(created[0]).toMatchObject({ kind: 'rewind', source: 'system', show: 'Dark' });
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
  expect(c.state).toBe('idle');
  expect(captures).toEqual([]); // a rewind never triggers auto-pause
});

it('rewind is refused unless idle, and a hotkey start is ignored while rewinding', () => {
  c.handleGesture('start');
  expect(c.rewind()).toBe(false);
  c.handleGesture('cancel');
  c.rewind();
  c.handleGesture('start');
  expect(calls).toEqual(['start:mic', 'cancel', 'rewind:15']);
  expect(c.state).toBe('rewinding');
});

it('a rewind the overlay never answers fails after the watchdog', () => {
  c.rewind();
  vi.advanceTimersByTime(5000);
  expect(lastState()).toEqual({ kind: 'error', message: 'Rewind failed', retry: false });
  expect(c.state).toBe('idle');
});

it('an overlay error during rewind (empty buffer) flashes it', () => {
  c.rewind();
  c.onCaptureError('Nothing to rewind yet');
  expect(lastState()).toEqual({ kind: 'error', message: 'Nothing to rewind yet', retry: false });
  expect(c.state).toBe('idle');
});

it('a failed rewind save keeps kind and context for retry', async () => {
  failNext = true;
  c.rewind();
  await c.onAudio(audio(15_000, 'system'));
  expect(c.state).toBe('failed');
  await c.retry();
  expect(created[1]).toMatchObject({ kind: 'rewind', show: 'Dark' });
});

it('capture start/end fire once around a recording: stop', () => {
  source = 'mic';
  c.handleGesture('start');
  c.handleGesture('stop');
  expect(captures).toEqual(['start:mic', 'end']);
});

it('capture end fires on cancel, capture error and a recorder that ended itself', async () => {
  c.handleGesture('start');
  c.handleGesture('cancel');
  c.handleGesture('start');
  c.onCaptureError('No microphone');
  c.handleGesture('start');
  await c.onAudio(audio(1000)); // mic unplugged mid-recording
  expect(captures).toEqual(['start:mic', 'end', 'start:mic', 'end', 'start:mic', 'end']);
});

it('stop then audio fires capture end only once', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(1000));
  expect(captures).toEqual(['start:mic', 'end']);
});

it('notify flashes a message only while idle, then returns to idle', () => {
  c.notify('Turn on film mode to rewind');
  expect(lastState()).toEqual({ kind: 'error', message: 'Turn on film mode to rewind', retry: false });
  vi.advanceTimersByTime(3000);
  expect(lastState()).toEqual(IDLE);
  c.handleGesture('start');
  const n = states.length;
  c.notify('ignored');
  expect(states).toHaveLength(n);
});
