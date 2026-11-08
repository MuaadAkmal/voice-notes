import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
let listAdd: (text: string, capture: Capture | null) => Promise<{ ok: boolean; message: string; undo?: { id: string; pages: { id: string; title: string }[] } }>;
let capture: Capture | null;
let reminderOn: boolean;
let ctl: DictationController;
let ports: DictationPorts;
/** What the pill shows now, when a test says something else took it over. */
let shown: OverlayState | null;

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
  shown = null;
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
      showing: () => shown ?? states.at(-1) ?? IDLE,
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

const polished = () => {
  ctl = new DictationController({
    ...ports,
    polish: async (text) => {
      log.push(`polish:${text}`);
      return 'Hello.';
    },
  });
};

it('the tidied text is what gets saved and pasted', async () => {
  polished();
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log.slice(-4)).toEqual(['polish:hello', 'save:Hello.:Slack', 'paste:Hello.', 'idle']);
});

it('a command is read as said and never tidied', async () => {
  polished();
  listOn = true;
  transcribe = async () => 'pixie add milk to groceries';
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  await ctl.onAudio(audio(800));
  expect(log.some((l) => l.startsWith('polish:'))).toBe(false);
  expect(log.some((l) => l.startsWith('list:'))).toBe(true);
});

it('cancelling during the cleanup pastes nothing', async () => {
  let finish = (_: string) => undefined as void;
  ctl = new DictationController({ ...ports, polish: () => new Promise((r) => (finish = r)) });
  ctl.handleGesture('start');
  ctl.handleGesture('stop');
  const done = ctl.onAudio(audio(800));
  await flush();
  ctl.handleGesture('cancel');
  finish('Hello.');
  await done;
  expect(log.some((l) => l.startsWith('paste:') || l.startsWith('save:'))).toBe(false);
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

describe('Undo / Move to… on a voice-to-lists flash', () => {
  const UNDO = { id: 'u1', pages: [{ id: 't', title: 'Tamil' }] };
  const added = async () => {
    listOn = true;
    transcribe = async () => 'Pixie, add milk.';
    listAdd = async () => ({ ok: true, message: 'Added · milk → Groceries', undo: UNDO });
    ctl.handleGesture('start');
    ctl.handleGesture('stop');
    await ctl.onAudio(audio(800));
  };

  it('shows the buttons for 6 s', async () => {
    await added();
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Added · milk → Groceries', undo: UNDO });
    await vi.advanceTimersByTimeAsync(5900);
    expect(states.at(-1)).toMatchObject({ undo: UNDO });
    await vi.advanceTimersByTimeAsync(200);
    expect(states.at(-1)).toEqual(IDLE);
  });

  it('holds while hovered or picking, and restarts the 6 s after', async () => {
    await added();
    ctl.holdFlash();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(states.at(-1)).toMatchObject({ undo: UNDO });
    ctl.releaseFlash();
    await vi.advanceTimersByTimeAsync(5900);
    expect(states.at(-1)).toMatchObject({ undo: UNDO });
    await vi.advanceTimersByTimeAsync(200);
    expect(states.at(-1)).toEqual(IDLE);
  });

  it('shows the result of an undo or move briefly', async () => {
    await added();
    ctl.holdFlash();
    ctl.showResult('Undone');
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Undone' });
    await vi.advanceTimersByTimeAsync(2600);
    expect(states.at(-1)).toEqual(IDLE);
  });

  it('a new capture drops a held flash', async () => {
    await added();
    ctl.holdFlash();
    ctl.dismissFlash();
    ctl.releaseFlash(); // the picker closing afterwards must not bring it back
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states.filter((s) => s.kind === 'done' && 'undo' in s)).toHaveLength(1);
  });

  it('a new dictation forgets the flash, so hovering the recording pill cannot end it', async () => {
    await added();
    ctl.handleGesture('start');
    const recording = states.at(-1);
    ctl.holdFlash();
    ctl.releaseFlash();
    await vi.advanceTimersByTimeAsync(7000);
    expect(states.at(-1)).toEqual(recording);
  });

  it('its timer leaves alone a pill that something else took over (a rewind, a notice)', async () => {
    await added();
    const rewinding: OverlayState = { kind: 'busy', message: 'Saving…' };
    shown = rewinding;
    await vi.advanceTimersByTimeAsync(7000);
    expect(states.at(-1)).not.toEqual(IDLE);
  });

  it('other flashes are not held', async () => {
    ctl.holdFlash();
    ctl.releaseFlash();
    expect(states).toEqual([]);
  });
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

describe('typed text', () => {
  const UNDO = { id: 'u1', pages: [] };
  beforeEach(() => {
    ports.note = async (text) => {
      log.push(`note:${text}`);
      return { ok: true, message: `Added · ${text} → Quick notes`, undo: UNDO };
    };
    ctl = new DictationController(ports);
  });

  it('plain text goes to Quick notes with Undo, never pasted or saved to the panel', async () => {
    await ctl.runTyped('milk');
    expect(log).toEqual(['note:milk']);
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Added · milk → Quick notes', undo: UNDO });
    expect(ctl.state).toBe('idle');
  });

  it('a reminder is set, shown busy first', async () => {
    reminderOn = true;
    await ctl.runTyped('remind me to call mom at 5');
    expect(states[0]).toEqual({ kind: 'busy', message: 'Setting reminder…' });
    expect(log.filter((l) => l !== 'idle')).toEqual(['remind:remind me to call mom at 5']);
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Reminder · call mom · 5:40 PM' });
  });

  it('a Pixie command goes to the list with no window capture, even one left from a dictation', async () => {
    listOn = true;
    capture = { hwnd: 1, title: 'x', processName: 'x.exe', pid: 1 };
    ctl.handleGesture('start');
    ctl.handleGesture('cancel');
    let seen: Capture | null | undefined;
    listAdd = async (text, c) => {
      seen = c;
      log.push(`list:${text}`);
      return { ok: true, message: 'Added · milk → Groceries' };
    };
    log = [];
    await ctl.runTyped('Pixie, add milk to my grocery list');
    expect(log.filter((l) => l !== 'idle')).toEqual(['list:add milk to my grocery list']);
    expect(seen).toBeNull();
  });

  it('a failed calendar add saves the text to Quick notes instead of pasting', async () => {
    calendarOn = true;
    calendarAdd = async () => ({ ok: false, message: 'Reconnect Google Calendar' });
    await ctl.runTyped('calendar lunch tomorrow 1pm');
    expect(log.filter((l) => l !== 'idle')).toEqual(['note:calendar lunch tomorrow 1pm']);
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Reconnect Google Calendar · saved to Quick notes', undo: UNDO });
  });

  it('is refused while a dictation is running', async () => {
    ctl.handleGesture('start');
    await ctl.runTyped('milk');
    expect(log).not.toContain('note:milk');
  });

  it('offerMove shows the flash with the picker open and holds it until released', async () => {
    const undo = { id: 'u1', pages: [{ id: 'p', title: 'Tamil' }] };
    ctl.offerMove('Move last item to…', undo);
    expect(states.at(-1)).toEqual({ kind: 'done', message: 'Move last item to…', undo, pick: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)?.kind).toBe('done');
    ctl.releaseFlash(); // the picker was cancelled: nothing left to offer, back to the idle pill at once
    expect(states.at(-1)).toEqual(IDLE);
  });

  it('a Quick notes write that throws says so instead of failing silently', async () => {
    ports.note = async () => {
      throw new Error('disk full');
    };
    ctl = new DictationController(ports);
    await ctl.runTyped('milk');
    expect(states.at(-1)).toEqual({ kind: 'error', message: "Couldn't save the note", retry: false });
    expect(ctl.state).toBe('idle');
  });
});
