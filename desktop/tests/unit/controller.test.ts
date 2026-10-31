import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoteSink, type OverlayPort, RecorderController } from '../../src/main/recorder/controller';
import type { NewAudio } from '../../src/main/store/note-store';
import type { Note, OverlayState, RecordingSource } from '../../src/shared/ipc';

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
  folderId: null,
  source: a.source,
  kind: a.kind ?? 'note',
  windowTitle: a.windowTitle ?? null,
  show: a.show ?? null,
  starred: false,
  transcript: null,
  transcriptLang: null,
  transcribedAt: null,
});

let calls: string[];
let states: OverlayState[];
let saved: Note[];
let failNext: boolean;
let created: NewAudio[];
let idles: number;
let abandoned: number;
let source: RecordingSource;
let blocked: boolean;
let c: RecorderController;
const audio = (durationMs: number): NewAudio => ({
  bytes: Buffer.from('xyz'),
  durationMs,
  mimeType: 'audio/webm;codecs=opus',
  source: 'mic',
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
  idles = 0;
  abandoned = 0;
  source = 'mic';
  blocked = false;
  const overlay: OverlayPort = {
    start: (d, s) => calls.push(`start:${d}:${s}`),
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
      return fakeNote(a);
    },
  };
  c = new RecorderController(overlay, sink, {
    getDeviceId: () => 'mic-1',
    getSource: () => source,
    onSaved: (n) => saved.push(n),
    idleState: () => IDLE,
    onIdle: () => idles++,
    onTitleAbandoned: () => abandoned++,
    blocked: () => blocked,
  });
});
afterEach(() => vi.useRealTimers());

it('start → overlay.start with device id and recording state (mode hold)', () => {
  c.handleGesture('start');
  expect(calls).toEqual(['start:mic-1:mic']);
  expect(lastState()).toEqual({ kind: 'recording', mode: 'hold', startedAt: 1_000_000, source: 'mic' });
  expect(c.state).toBe('recording');
});

it('handsfree switches mode, keeps startedAt', () => {
  c.handleGesture('start');
  vi.advanceTimersByTime(300);
  c.handleGesture('handsfree');
  expect(lastState()).toEqual({ kind: 'recording', mode: 'handsfree', startedAt: 1_000_000, source: 'mic' });
});

it('stop then audio ≥300ms saves, shows saved with the note id, then idle after 4000ms', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  expect(calls).toEqual(['start:mic-1:mic', 'stop']);
  await c.onAudio(audio(1200));
  expect(saved).toHaveLength(1);
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
  vi.advanceTimersByTime(3999);
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
  vi.advanceTimersByTime(1);
  expect(lastState()).toEqual(IDLE);
  expect(c.state).toBe('idle');
});

it('audio of 1 s or less is dropped without save', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(1000));
  expect(created).toEqual([]);
  expect(lastState()).toEqual(IDLE);
  expect(c.state).toBe('idle');
});

it('a clip that heard nothing is dropped and the pill says so', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(5000), { silent: true });
  expect(created).toEqual([]);
  expect(lastState()).toEqual({ kind: 'error', message: 'Nothing heard · not saved', retry: false });
  expect(c.state).toBe('idle');
  vi.advanceTimersByTime(3000);
  expect(lastState()).toEqual(IDLE);
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
  expect(calls).toEqual(['start:mic-1:mic', 'stop']);
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
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
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

it('audio while recording is saved (recorder ended on its own)', async () => {
  c.handleGesture('start');
  await c.onAudio(audio(1500));
  expect(created).toHaveLength(1);
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
  expect(c.state).toBe('idle');
});

it('stopping without audio for 5000ms → "Recording lost", then idle', () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  vi.advanceTimersByTime(4999);
  expect(c.state).toBe('stopping');
  vi.advanceTimersByTime(1);
  expect(lastState()).toEqual({ kind: 'error', message: 'Recording lost', retry: false });
  expect(c.state).toBe('idle');
});

it('audio arriving in time cancels the stopping watchdog', async () => {
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio(audio(1500));
  vi.advanceTimersByTime(10_000);
  expect(states.some((s) => s.kind === 'error')).toBe(false);
});

it('calls onIdle when it returns to idle on its own', async () => {
  c.handleGesture('start');
  c.onCaptureError('No microphone');
  expect(idles).toBe(1);
  c.handleGesture('start');
  vi.advanceTimersByTime(300_000); // auto-stop
  await c.onAudio(audio(2000));
  expect(idles).toBe(2);
});

it('start passes the recording source to the overlay', () => {
  source = 'system';
  c.handleGesture('start');
  expect(calls).toEqual(['start:mic-1:system']);
  expect(lastState()).toMatchObject({ kind: 'recording', source: 'system' });
});

it('saved flash notes a mic-only fallback', async () => {
  source = 'both';
  c.handleGesture('start');
  c.handleGesture('stop');
  await c.onAudio({ ...audio(2000), source: 'mic' });
  expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1', micOnly: true });
  expect(created[0].source).toBe('mic');
});
describe('titling from the pill', () => {
  const save = async () => {
    c.handleGesture('start');
    c.handleGesture('stop');
    await c.onAudio(audio(1500));
  };

  it('remembers the last saved note id', async () => {
    expect(c.lastSavedId).toBeNull();
    await save();
    expect(c.lastSavedId).toBe('n1');
  });

  it('holdFlash keeps the saved state past the 4000ms flash', async () => {
    await save();
    c.holdFlash();
    vi.advanceTimersByTime(10_000);
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
  });

  it('titleDone shows saved for 1000ms, then idle', async () => {
    await save();
    c.holdFlash();
    c.titleDone();
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1', titled: true });
    vi.advanceTimersByTime(1000);
    expect(lastState()).toEqual(IDLE);
  });

  it('titleCancelled goes idle immediately', async () => {
    await save();
    c.holdFlash();
    c.titleCancelled();
    expect(lastState()).toEqual(IDLE);
  });

  it('hover pauses the countdown; leaving restarts the full 4000ms', async () => {
    await save();
    vi.advanceTimersByTime(3000);
    c.pauseFlash();
    vi.advanceTimersByTime(10_000);
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
    c.resumeFlash();
    vi.advanceTimersByTime(3999);
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
    vi.advanceTimersByTime(1);
    expect(lastState()).toEqual(IDLE);
  });

  it('holdFlash reports whether a saved flash was showing', async () => {
    expect(c.holdFlash()).toBe(false);
    await save();
    expect(c.holdFlash()).toBe(true);
  });

  it('titleCancelled after a new recording started leaves the recording pill alone', async () => {
    await save();
    c.holdFlash();
    c.handleGesture('start');
    const before = states.length;
    c.titleCancelled();
    expect(states.length).toBe(before);
    expect(lastState()).toMatchObject({ kind: 'recording' });
  });

  it('titleDone after a new recording started does not flash over it', async () => {
    await save();
    c.holdFlash();
    c.handleGesture('start');
    c.titleDone();
    vi.advanceTimersByTime(2000);
    expect(lastState()).toMatchObject({ kind: 'recording' });
  });

  it('a held title that never finishes is abandoned after 15000ms', async () => {
    await save();
    c.holdFlash();
    vi.advanceTimersByTime(14_999);
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
    vi.advanceTimersByTime(1);
    expect(lastState()).toEqual(IDLE);
    expect(abandoned).toBe(1);
  });

  it('a new recording can start while a title is being typed', async () => {
    await save();
    c.holdFlash();
    c.handleGesture('start');
    expect(c.state).toBe('recording');
    expect(lastState()).toMatchObject({ kind: 'recording' });
  });
});

describe('next to a dictation', () => {
  it('a blocked start is ignored', () => {
    blocked = true;
    c.handleGesture('start');
    expect(c.state).toBe('idle');
    expect(calls).toEqual([]);
  });

  it('a blocked rewind is refused', () => {
    blocked = true;
    expect(c.rewind()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('a message or idle refresh never overwrites the dictation pill', () => {
    blocked = true;
    c.notify('Turn on film mode to rewind');
    c.refreshIdle();
    expect(states).toEqual([]);
  });

  it('dictation start dismisses the recorder flash', async () => {
    c.handleGesture('start');
    c.handleGesture('stop');
    await c.onAudio(audio(1200));
    expect(lastState()).toEqual({ kind: 'saved', noteId: 'n1' });
    const n = states.length;
    c.dismissFlash();
    vi.advanceTimersByTime(5000);
    expect(states).toHaveLength(n);
    expect(c.holdFlash()).toBe(false); // the saved flash is gone: no title input can open on it
  });
});

describe('auto-stop at 300 s (every provider)', () => {
  for (const s of ['mic', 'system', 'both'] as const) {
    it(`a ${s} note still recording at 300 s stops like a normal stop, and a new one can start`, async () => {
      source = s;
      c.handleGesture('start');
      vi.advanceTimersByTime(299_999);
      expect(calls).not.toContain('stop');
      vi.advanceTimersByTime(1);
      expect(calls).toContain('stop');
      await c.onAudio({ ...audio(300_000), source: s });
      expect(saved).toHaveLength(1);
      expect(lastState()).toMatchObject({ kind: 'saved' });
      expect(states.some((st) => st.kind === 'error')).toBe(false);
      c.handleGesture('start');
      expect(c.state).toBe('recording');
    });
  }
});
