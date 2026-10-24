import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type NoteSink, type OverlayPort, RecorderController } from '../../src/main/recorder/controller';
import type { NewAudio } from '../../src/main/store/note-store';
import type { Note, OverlayState } from '../../src/shared/ipc';

const IDLE: OverlayState = { kind: 'idle', visible: true };
const fakeNote = (a: NewAudio): Note => ({
  id: 'n1',
  title: 't',
  filePath: 'recordings/n1.webm',
  durationMs: a.durationMs,
  sizeBytes: a.bytes.length,
  mimeType: a.mimeType,
  status: 'ok',
  createdAt: 0,
  updatedAt: 0,
  syncedAt: null,
});

let calls: string[];
let states: OverlayState[];
let saved: Note[];
let failNext: boolean;
let created: NewAudio[];
let c: RecorderController;
const audio = (durationMs: number): NewAudio => ({
  bytes: Buffer.from('xyz'),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
});
const lastState = () => states[states.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  calls = [];
  states = [];
  saved = [];
  created = [];
  failNext = false;
  const overlay: OverlayPort = {
    start: (d) => calls.push(`start:${d}`),
    stop: () => calls.push('stop'),
    cancel: () => calls.push('cancel'),
    setState: (s) => states.push(s),
  };
  const sink: NoteSink = {
    create: async (a) => {
      created.push(a);
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      return fakeNote(a);
    },
  };
  c = new RecorderController(overlay, sink, {
    getDeviceId: () => 'mic-1',
    onSaved: (n) => saved.push(n),
    idleState: () => IDLE,
  });
});
afterEach(() => vi.useRealTimers());

it('start → overlay.start with device id and recording state (mode hold)', () => {
  c.handleGesture('start');
  expect(calls).toEqual(['start:mic-1']);
  expect(lastState()).toEqual({ kind: 'recording', mode: 'hold', startedAt: 1_000_000 });
  expect(c.state).toBe('recording');
});

it('handsfree switches mode, keeps startedAt', () => {
  c.handleGesture('start');
  vi.advanceTimersByTime(300);
  c.handleGesture('handsfree');
  expect(lastState()).toEqual({ kind: 'recording', mode: 'handsfree', startedAt: 1_000_000 });
});

it('stop then audio ≥300ms saves, shows saved, then idle after 1000ms', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  expect(calls).toEqual(['start:mic-1', 'stop']);
  await c.onAudio(audio(1200));
  expect(saved).toHaveLength(1);
  expect(lastState()).toEqual({ kind: 'saved' });
  vi.advanceTimersByTime(1000);
  expect(lastState()).toEqual(IDLE);
  expect(c.state).toBe('idle');
});

it('audio <300ms is dropped without save', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(299));
  expect(created).toEqual([]);
  expect(lastState()).toEqual(IDLE);
  expect(c.state).toBe('idle');
});

it('ignores audio after cancel', async () => {
  c.handleGesture('start');
  c.handleGesture('cancel');
  expect(calls).toContain('cancel');
  await c.onAudio(audio(2000));
  expect(created).toEqual([]);
  expect(lastState()).toEqual(IDLE);
});

it('auto-stops at max duration', () => {
  c.handleGesture('start');
  vi.advanceTimersByTime(300_000);
  expect(calls).toEqual(['start:mic-1', 'stop']);
  expect(c.state).toBe('stopping');
});

it('save failure shows retry; retry saves the same bytes', async () => {
  failNext = true;
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(2000));
  expect(c.state).toBe('failed');
  expect(lastState()).toEqual({ kind: 'error', message: 'Save failed — Retry', retry: true });
  await c.retry();
  expect(created).toHaveLength(2);
  expect(created[1]).toBe(created[0]);
  expect(saved).toHaveLength(1);
  expect(lastState()).toEqual({ kind: 'saved' });
});

it('start gesture ignored while failed', async () => {
  failNext = true;
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(2000));
  c.handleGesture('start');
  expect(calls.filter((x) => x.startsWith('start'))).toHaveLength(1);
  expect(c.state).toBe('failed');
});

it('capture error shows message then idle after 3000ms', () => {
  c.handleGesture('start');
  c.onCaptureError('No microphone');
  expect(lastState()).toEqual({ kind: 'error', message: 'No microphone', retry: false });
  vi.advanceTimersByTime(3000);
  expect(lastState()).toEqual(IDLE);
  expect(c.state).toBe('idle');
});
