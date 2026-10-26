import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OverlayState } from '../../src/shared/channels';
import { DictationController, type DictationPorts } from '../../src/main/dictation/controller';

const IDLE: OverlayState = { kind: 'idle', visible: true };
let log: string[];
let states: OverlayState[];
let configured: boolean;
let blocked: boolean;
let transcribe: (wav: Uint8Array, signal: AbortSignal) => Promise<string>;
let save: (text: string, app: string | null) => void;
let paste: (text: string) => Promise<void>;
let ctl: DictationController;

const audio = (durationMs: number) => ({ bytes: new Uint8Array([1, 2, 3]), durationMs });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  states = [];
  configured = true;
  blocked = false;
  transcribe = async () => ' hello';
  save = (text, app) => log.push(`save:${text}:${app}`);
  paste = async (text) => {
    log.push(`paste:${text}`);
  };
  const ports: DictationPorts = {
    overlay: {
      start: (deviceId, ping) => log.push(`start:${deviceId}:${ping}`),
      stop: () => log.push('stop'),
      cancel: () => log.push('cancel'),
      setState: (s) => states.push(s),
    },
    configured: () => configured,
    blocked: () => blocked,
    getDeviceId: () => 'mic1',
    sound: () => true,
    getApp: () => 'Slack',
    transcribe: (wav, signal) => transcribe(wav, signal),
    save: (text, app) => save(text, app),
    paste: (text) => paste(text),
    idleState: () => IDLE,
    onIdle: () => log.push('idle'),
    onCaptureStart: () => log.push('capture-start'),
    onCaptureEnd: () => log.push('capture-end'),
  };
  ctl = new DictationController(ports);
});
afterEach(() => vi.useRealTimers());

it('hold: records, transcribes, saves, then pastes', async () => {
  ctl.handleGesture('start');
  expect(states.at(-1)).toMatchObject({ kind: 'recording', mode: 'hold', source: 'mic', dictation: true });
  expect(ctl.active).toBe(true);
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.map((s) => s.kind)).toEqual(['recording', 'busy', 'idle']);
  expect(states[1]).toEqual({ kind: 'busy', message: 'Transcribing…' });
  expect(log).toEqual(['start:mic1:true', 'capture-start', 'stop', 'capture-end', 'save:hello:Slack', 'paste:hello', 'idle']);
  expect(ctl.state).toBe('idle');
});

it('handsfree updates the mode', () => {
  ctl.handleGesture('start');
  ctl.handleGesture('handsfree');
  expect(states.at(-1)).toMatchObject({ kind: 'recording', mode: 'handsfree', dictation: true });
});

it('too short is dropped silently', async () => {
  let asked = false;
  transcribe = async () => {
    asked = true;
    return 'x';
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(300));
  expect(asked).toBe(false);
  expect(states.at(-1)).toEqual(IDLE);
  expect(ctl.state).toBe('idle');
});

it('not configured flashes and does not record', async () => {
  configured = false;
  ctl.handleGesture('start');
  expect(log).not.toContain('start:mic1:true');
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'Set up transcription first', retry: false });
  await vi.advanceTimersByTimeAsync(3000);
  expect(states.at(-1)).toEqual(IDLE);
});

it('refused while a voice note is busy', () => {
  blocked = true;
  ctl.handleGesture('start');
  expect(log).toEqual([]);
  expect(ctl.state).toBe('idle');
});

it('cancel while listening cancels capture', () => {
  ctl.handleGesture('start');
  ctl.handleGesture('cancel');
  expect(log).toContain('cancel');
  expect(log).toContain('capture-end');
  expect(states.at(-1)).toEqual(IDLE);
  expect(ctl.state).toBe('idle');
});

it('cancel while transcribing never pastes or stores', async () => {
  let resolve!: (t: string) => void;
  let signal!: AbortSignal;
  transcribe = (_wav, s) => {
    signal = s;
    return new Promise((r) => (resolve = r));
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  const done = ctl.onAudio(audio(800));
  await flush();
  ctl.handleGesture('cancel');
  expect(signal.aborted).toBe(true);
  expect(states.at(-1)).toEqual(IDLE);
  resolve('late');
  await done;
  expect(log.some((l) => l.startsWith('save') || l.startsWith('paste'))).toBe(false);
});

it('empty transcript flashes No speech heard', async () => {
  transcribe = async () => '  ';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'No speech heard', retry: false });
  expect(log.some((l) => l.startsWith('save'))).toBe(false);
});

it('server failure flashes its message for 3 s, then idle', async () => {
  transcribe = async () => {
    throw new Error("Couldn't reach the transcription server");
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.at(-1)).toEqual({ kind: 'error', message: "Couldn't reach the transcription server", retry: false });
  expect(ctl.state).toBe('idle');
  await vi.advanceTimersByTimeAsync(3000);
  expect(states.at(-1)).toEqual(IDLE);
});

it('no audio within 5 s of stop flashes Recording failed', async () => {
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await vi.advanceTimersByTimeAsync(5000);
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'Recording failed', retry: false });
  expect(ctl.state).toBe('idle');
});

it('a capture error flashes its message', () => {
  ctl.handleGesture('start');
  ctl.onCaptureError('No microphone');
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'No microphone', retry: false });
  expect(ctl.state).toBe('idle');
});

it('a failing paste still returns to idle', async () => {
  paste = async () => {
    throw new Error('no koffi');
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(ctl.state).toBe('idle');
  expect(log.at(-1)).toBe('idle');
});

it('a failing save still pastes', async () => {
  save = () => {
    throw new Error('disk full');
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log).toContain('paste:hello');
});

it('a start while transcribing is ignored', async () => {
  transcribe = () => new Promise(() => undefined);
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  void ctl.onAudio(audio(800));
  await flush();
  ctl.handleGesture('start');
  expect(log.filter((l) => l.startsWith('start'))).toHaveLength(1);
});

it('dismissFlash stops a pending error flash from resetting the pill', async () => {
  configured = false;
  ctl.handleGesture('start');
  const n = states.length;
  ctl.dismissFlash();
  await vi.advanceTimersByTimeAsync(3000);
  expect(states).toHaveLength(n);
});
