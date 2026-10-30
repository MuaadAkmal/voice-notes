import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OverlayState } from '../../src/shared/channels';
import { DictationController, type DictationPorts } from '../../src/main/dictation/controller';
import type { Capture } from '../../src/main/commands/capture';
import { CloudNotSignedIn, QuotaExceeded } from '../../src/main/transcription/cloud-client';

const IDLE: OverlayState = { kind: 'idle', visible: true };
let log: string[];
let states: OverlayState[];
let configured: boolean;
let blocked: boolean;
let transcribe: (wav: Uint8Array, signal: AbortSignal) => Promise<string>;
let save: (text: string, app: string | null) => void;
let paste: (text: string) => Promise<void>;
let calendarOn: boolean;
let calendarAdd: (text: string) => Promise<{ ok: boolean; message: string }>;
let listOn: boolean;
let listAdd: (text: string, capture: Capture | null) => Promise<{ ok: boolean; message: string }>;
let capture: Capture | null;
let reminderOn: boolean;
let ctl: DictationController;
let ports: DictationPorts;

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
  calendarOn = false;
  calendarAdd = async (text) => {
    log.push(`add:${text}`);
    return { ok: true, message: 'Added · Lunch · Fri 30 Oct, 13:00' };
  };
  listOn = false;
  reminderOn = false;
  capture = null;
  listAdd = async (text) => {
    log.push(`list:${text}`);
    return { ok: true, message: 'Added · blueberry → Groceries' };
  };
  ports = {
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
    getCapture: () => capture,
    transcribe: (wav, signal) => transcribe(wav, signal),
    save: (text, app) => save(text, app),
    paste: (text) => paste(text),
    idleState: () => IDLE,
    calendar: { enabled: () => calendarOn, add: (text) => calendarAdd(text) },
    list: { enabled: () => listOn, wakeWords: () => ['Pixie'], add: (text, c) => listAdd(text, c) },
    reminder: {
      enabled: () => reminderOn,
      add: async (text) => {
        log.push(`remind:${text}`);
        return { ok: true, message: 'Reminder · call mom · 5:40 PM' };
      },
    },
    onIdle: () => log.push('idle'),
    onCaptureStart: () => log.push('capture-start'),
    onCaptureEnd: () => log.push('capture-end'),
    prewarm: () => log.push('prewarm'),
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
  expect(log).toEqual(['prewarm', 'start:mic1:true', 'capture-start', 'stop', 'capture-end', 'save:hello:Slack', 'paste:hello', 'idle']);
  expect(ctl.state).toBe('idle');
});

it('loads the engine once when listening starts, never when refused', () => {
  blocked = true;
  ctl.handleGesture('start');
  expect(log).not.toContain('prewarm');
  blocked = false;
  ctl.handleGesture('start');
  ctl.handleGesture('handsfree');
  expect(log.filter((l) => l === 'prewarm')).toHaveLength(1);
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

it('voice to calendar: a trigger adds an event instead of pasting', async () => {
  calendarOn = true;
  transcribe = async () => 'Calendar, lunch tomorrow 1pm.';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log).toContain('save:📅 Calendar, lunch tomorrow 1pm.:Slack');
  expect(log).toContain('add:lunch tomorrow 1pm');
  expect(log.some((l) => l.startsWith('paste:'))).toBe(false);
  expect(states.slice(-2)).toEqual([
    { kind: 'busy', message: 'Adding to calendar…' },
    { kind: 'done', message: 'Added · Lunch · Fri 30 Oct, 13:00' },
  ]);
  expect(ctl.state).toBe('idle');
  await vi.advanceTimersByTimeAsync(3000);
  expect(states.at(-1)).toEqual(IDLE);
});

it('voice to calendar: a failed add says why, then pastes the text', async () => {
  calendarOn = true;
  transcribe = async () => 'Calendar lunch at 1';
  calendarAdd = async () => ({ ok: false, message: "Can't reach Google." });
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.at(-1)).toEqual({ kind: 'error', message: "Can't reach Google.", retry: false });
  expect(log).toContain('paste:Calendar lunch at 1');
  expect(ctl.state).toBe('idle');
});

it('voice to calendar: off, or no trigger, pastes as usual', async () => {
  transcribe = async () => 'Calendar lunch at 1';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  calendarOn = true;
  transcribe = async () => 'Schedule is tight';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log.filter((l) => l.startsWith('paste:') || l.startsWith('add:'))).toEqual(['paste:Calendar lunch at 1', 'paste:Schedule is tight']);
});

it('voice to lists: the wake word adds to a list instead of pasting', async () => {
  listOn = true;
  transcribe = async () => 'Pixie, add blueberry to my grocery list.';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log).toContain('save:📝 Pixie, add blueberry to my grocery list.:Slack');
  expect(log).toContain('list:add blueberry to my grocery list');
  expect(log.some((l) => l.startsWith('paste:'))).toBe(false);
  expect(states.slice(-2)).toEqual([
    { kind: 'busy', message: 'Saving note…' },
    { kind: 'done', message: 'Added · blueberry → Groceries' },
  ]);
  expect(ctl.state).toBe('idle');
});

it('voice to lists: a failed add says why, then pastes the text', async () => {
  listOn = true;
  transcribe = async () => 'Pixie milk to shopping';
  listAdd = async () => ({ ok: false, message: 'No matching list' });
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'No matching list', retry: false });
  expect(log).toContain('paste:Pixie milk to shopping');
});

it('voice to lists: a throwing add still pastes', async () => {
  listOn = true;
  transcribe = async () => 'Pixie milk to shopping';
  listAdd = async () => {
    throw new Error('boom');
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(states.at(-1)).toEqual({ kind: 'error', message: "Couldn't save the note", retry: false });
  expect(log).toContain('paste:Pixie milk to shopping');
});

it('voice to lists: off, or no wake word, pastes as usual; the calendar trigger comes first', async () => {
  transcribe = async () => 'Pixie milk to shopping';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  listOn = true;
  calendarOn = true;
  transcribe = async () => 'Notebook is here';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  transcribe = async () => 'Calendar lunch at 1';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  await vi.advanceTimersByTimeAsync(3000);
  expect(log.filter((l) => /^(paste|add|list):/.test(l))).toEqual(['paste:Pixie milk to shopping', 'paste:Notebook is here', 'add:lunch at 1']);
});

it('voice to lists: passes the window that was in front at key-down', async () => {
  listOn = true;
  const CAP: Capture = { hwnd: 7, title: 'V - YouTube - Google Chrome', processName: 'chrome.exe', pid: 9 };
  capture = CAP;
  let got: Capture | null = null;
  listAdd = async (_text, c) => ((got = c), { ok: true, message: 'Added · V → YouTube' });
  transcribe = async () => 'Pixie, add this to YouTube';
  ctl.handleGesture('start');
  capture = { ...CAP, hwnd: 8, title: 'Other' }; // switched windows while speaking
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(got).toEqual(CAP);
});

it('voice reminders: with or without the wake word or the calendar trigger, before lists and calendar', async () => {
  reminderOn = listOn = calendarOn = true;
  for (const said of ['Pixie, remind me to buy milk in 5 min.', 'Remind me to buy milk in 5 min', 'Calendar, remind me to buy milk in 5 min']) {
    log = [];
    transcribe = async () => said;
    ctl.handleGesture('start');
    ctl.handleGesture('stop');
    await ctl.onAudio(audio(800));
    expect(log).toContain(`save:⏰ ${said}:Slack`);
    expect(log.filter((l) => /^(remind|list|add|paste):/.test(l))).toEqual([`remind:${said.replace(/^(Pixie|Calendar), /, '').replace(/\.$/, '')}`]);
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Reminder · call mom · 5:40 PM' });
    await vi.advanceTimersByTimeAsync(3000);
  }
});

it('voice reminders: off, the wake word goes to lists as before', async () => {
  listOn = true;
  transcribe = async () => 'Pixie, remind me to buy milk';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log).toContain('list:remind me to buy milk');
});

it('signed out keeps cloud: a cloud failure shows the message, pastes nothing, saves nothing', async () => {
  transcribe = async () => {
    throw new CloudNotSignedIn();
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(2000));
  expect(states.at(-1)).toEqual({ kind: 'error', message: new CloudNotSignedIn().message, retry: false });
  expect(log.some((l) => l.startsWith('paste:') || l.startsWith('save:'))).toBe(false);
  expect(ctl.state).toBe('idle');
});

it('a quota failure shows the message, pastes nothing, saves nothing', async () => {
  transcribe = async () => {
    throw new QuotaExceeded('2026-11-01T00:00:00Z');
  };
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(2000));
  expect(states.at(-1)).toMatchObject({ kind: 'error', message: new QuotaExceeded('2026-11-01T00:00:00Z').message });
  expect(log.some((l) => l.startsWith('paste:') || l.startsWith('save:'))).toBe(false);
});

for (const mode of ['hold', 'handsfree'] as const) {
  it(`auto-stop at 300 s (${mode}, any provider): transcribed and pasted like a normal stop; a new one can start`, async () => {
    const c2 = ctl;
    c2.handleGesture('start');
    if (mode === 'handsfree') c2.handleGesture('handsfree');
    vi.advanceTimersByTime(299_999);
    expect(log).not.toContain('stop');
    vi.advanceTimersByTime(1);
    expect(log).toContain('stop');
    await c2.onAudio(audio(300_000));
    expect(log).toContain('paste:hello');
    expect(log).toContain('save:hello:Slack');
    expect(states.at(-1)).toEqual(IDLE);
    c2.handleGesture('start');
    expect(c2.state).toBe('listening');
  });
}
