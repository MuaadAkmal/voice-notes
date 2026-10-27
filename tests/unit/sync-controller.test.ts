import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { SyncController, type SyncView } from '../../src/main/sync/controller';
import { AuthExpired, NotSignedIn, Offline, Rejected } from '../../src/main/sync/http-server';
import { AccountChanged } from '../../src/main/sync/engine';

const NONE = { notes: false, pages: false, folders: false, prefs: false };

class FakeState {
  account: string | null = null;
  net = false;
  rec = false;
  dismissed: string | null = null;
  accountId = () => this.account;
  setAccountId = (id: string | null) => void (this.account = id);
  network = () => this.net;
  setNetwork = (on: boolean) => void (this.net = on);
  enabled = () => this.rec;
  promptDismissedFor = () => this.dismissed;
  setPromptDismissedFor = (id: string | null) => void (this.dismissed = id);
}

let state: FakeState;
let user: string | null;
let views: SyncView[];
let changes: unknown[];
let script: (() => Promise<typeof NONE>)[];
let engine: {
  sync: ReturnType<typeof vi.fn<() => Promise<typeof NONE>>>;
  enable: ReturnType<typeof vi.fn<() => void>>;
  startFresh: ReturnType<typeof vi.fn<() => void>>;
};
let refreshed: number;
let files: { drain: ReturnType<typeof vi.fn<() => Promise<{ storageFull: boolean }>>>; waiting: () => number; left: number };
let ctl: SyncController;

const last = () => views[views.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  state = new FakeState();
  user = 'u1';
  views = [];
  changes = [];
  script = [];
  refreshed = 0;
  files = { drain: vi.fn(async () => ({ storageFull: false })), waiting: () => files.left, left: 0 };
  engine = {
    sync: vi.fn<() => Promise<typeof NONE>>(async () => (script.shift() ?? (async () => NONE))()),
    enable: vi.fn<() => void>(() => void (state.rec = true)),
    startFresh: vi.fn<() => void>(() => void (state.rec = true)),
  };
  ctl = new SyncController({
    engine,
    state,
    settings: () => DEFAULT_SETTINGS,
    currentUser: () => user,
    refreshSession: async () => void refreshed++,
    onView: (v) => views.push(v),
    onChanged: (c) => changes.push(c),
    files,
  });
  ctl.start();
});
afterEach(() => {
  ctl.stop();
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

it('is off until turned on, and asks once signed in', () => {
  expect(ctl.view()).toEqual({ status: { mode: 'off' }, needsPrompt: true, filesWaiting: 0, storageFull: false });
  expect(engine.sync).not.toHaveBeenCalled();
});

it('turning on binds the account, snapshots and syncs', async () => {
  ctl.turnOn('u1');
  await flush();
  expect(state.account).toBe('u1');
  expect(state.net).toBe(true);
  expect(engine.startFresh).toHaveBeenCalledTimes(1);
  expect(engine.sync).toHaveBeenCalledTimes(1);
  expect(last()).toEqual({ status: { mode: 'idle', lastSyncedAt: 1_000_000 }, needsPrompt: false, filesWaiting: 0, storageFull: false });
});

it('a burst of edits syncs once, 3 s after the last', async () => {
  ctl.turnOn('u1');
  await flush();
  engine.sync.mockClear();
  for (let i = 0; i < 5; i++) {
    ctl.onLocalChange();
    await vi.advanceTimersByTimeAsync(400);
  }
  await vi.advanceTimersByTimeAsync(2599); // now 4599: 1 ms before 3 s after the last edit
  expect(engine.sync).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.sync).toHaveBeenCalledTimes(1);
});

it('also syncs every 5 minutes and when the PC wakes', async () => {
  ctl.turnOn('u1');
  await flush();
  engine.sync.mockClear();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(engine.sync).toHaveBeenCalledTimes(1);
  ctl.onResume();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(2);
});

it('offline: retries at 30 s, 1, 2, 4, 8 then 10 min, and a success resets it', async () => {
  script = Array.from({ length: 6 }, () => async () => Promise.reject(new Offline()));
  ctl.turnOn('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'offline', retryAt: 1_000_000 + 30_000 });
  const gaps = [30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000];
  for (const gap of gaps.slice(0, 6)) {
    const before = engine.sync.mock.calls.length;
    await vi.advanceTimersByTimeAsync(gap - 1);
    expect(engine.sync.mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.sync.mock.calls.length).toBe(before + 1);
  }
  // the 7th attempt (just made) succeeds → idle; the next failure starts again at 30 s
  expect(last().status.mode).toBe('idle');
  script = [async () => Promise.reject(new Offline())];
  ctl.syncNow();
  await flush();
  expect(last().status).toEqual({ mode: 'offline', retryAt: Date.now() + 30_000 });
});

it('while waiting to retry, the 5-minute timer and new edits do not cut the wait short', async () => {
  script = Array.from({ length: 4 }, () => async () => Promise.reject(new Offline()));
  ctl.turnOn('u1');
  await flush(); // attempt 1 fails → retry in 30 s
  await vi.advanceTimersByTimeAsync(30_000 + 60_000 + 120_000); // attempts 2–4 fail → next retry in 240 s
  const calls = engine.sync.mock.calls.length;
  ctl.onLocalChange();
  await vi.advanceTimersByTimeAsync(239_999); // the 5-min tick and the edit's 3 s both pass in here
  expect(engine.sync.mock.calls.length).toBe(calls);
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.sync.mock.calls.length).toBe(calls + 1);
});

it('waking the PC, or Sync now, retries straight away', async () => {
  script = [async () => Promise.reject(new Offline())];
  ctl.turnOn('u1');
  await flush();
  const calls = engine.sync.mock.calls.length;
  ctl.onResume();
  await flush();
  expect(engine.sync.mock.calls.length).toBe(calls + 1);
});

it('an expired session is refreshed once; if that fails, it asks to sign in again', async () => {
  script = [async () => Promise.reject(new AuthExpired()), async () => NONE];
  ctl.turnOn('u1');
  await flush();
  expect(refreshed).toBe(1);
  expect(engine.sync).toHaveBeenCalledTimes(2);
  expect(last().status.mode).toBe('idle');

  script = [async () => Promise.reject(new AuthExpired()), async () => Promise.reject(new AuthExpired())];
  ctl.syncNow();
  await flush();
  expect(last().status).toEqual({ mode: 'error', message: 'Sign in again to keep syncing' });
});

it('a change the server rejects is shown, not retried in a loop', async () => {
  script = [async () => Promise.reject(new Rejected('Invalid change'))];
  ctl.turnOn('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'error', message: 'Invalid change' });
  const calls = engine.sync.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(engine.sync.mock.calls.length).toBe(calls);
});

it('signing out pauses; signing back in with the same account resumes', async () => {
  ctl.turnOn('u1');
  await flush();
  user = null;
  ctl.onAccountChanged();
  expect(last().status).toEqual({ mode: 'paused', reason: 'signed-out' });
  engine.sync.mockClear();
  ctl.onLocalChange();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(engine.sync).not.toHaveBeenCalled();
  expect(state.rec).toBe(true); // still recording
  user = 'u1';
  ctl.onAccountChanged();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  expect(last().status.mode).toBe('idle');
});

it('a different account is asked first, and starts fresh when turned on', async () => {
  ctl.turnOn('u1');
  await flush();
  user = 'u2';
  ctl.onAccountChanged();
  expect(last()).toEqual({ status: { mode: 'off' }, needsPrompt: true, filesWaiting: 0, storageFull: false });
  engine.startFresh.mockClear();
  ctl.turnOn('u2');
  await flush();
  expect(engine.startFresh).toHaveBeenCalledTimes(1);
  expect(state.account).toBe('u2');
});

it('the same account turned on again just resumes, without starting fresh', async () => {
  ctl.turnOn('u1');
  await flush();
  ctl.turnOff();
  engine.startFresh.mockClear();
  ctl.turnOn('u1');
  await flush();
  expect(engine.startFresh).not.toHaveBeenCalled();
  expect(engine.sync).toHaveBeenCalledTimes(2);
});

it('switching off stops syncing but keeps recording', async () => {
  ctl.turnOn('u1');
  await flush();
  ctl.turnOff();
  expect(last()).toEqual({ status: { mode: 'off' }, needsPrompt: false, filesWaiting: 0, storageFull: false });
  engine.sync.mockClear();
  ctl.onLocalChange();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(engine.sync).not.toHaveBeenCalled();
  expect(state.rec).toBe(true);
});

it('Not now is remembered for that account only', () => {
  ctl.dismissPrompt();
  expect(ctl.view().needsPrompt).toBe(false);
  user = 'u2';
  ctl.onAccountChanged();
  expect(ctl.view().needsPrompt).toBe(true);
});

it('a sync asked for while one is running happens right after it', async () => {
  let finish!: () => void;
  script = [() => new Promise((r) => (finish = () => r(NONE)))];
  ctl.turnOn('u1');
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  ctl.syncNow(); // e.g. Turn on for a new account, or an edit saved during the run
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(2);
});

it('a run cut short by an account change is not an error', async () => {
  script = [async () => Promise.reject(new AccountChanged())];
  ctl.turnOn('u1');
  await flush();
  expect(last().status.mode).toBe('idle');
});

it('what a pull changed is passed on', async () => {
  script = [async () => ({ ...NONE, pages: true })];
  ctl.turnOn('u1');
  await flush();
  expect(changes).toEqual([{ ...NONE, pages: true }]);
});

it('no session at sync time pauses instead of erroring', async () => {
  script = [async () => Promise.reject(new NotSignedIn())];
  ctl.turnOn('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'paused', reason: 'signed-out' });
});

it('after a successful sync the file queue drains and the view shows filesWaiting and storageFull', async () => {
  files.left = 3;
  files.drain.mockImplementation(async () => {
    files.left = 1;
    return { storageFull: true };
  });
  ctl.turnOn('u1');
  await flush();
  expect(files.drain).toHaveBeenCalledTimes(1);
  expect(engine.sync.mock.invocationCallOrder[0]).toBeLessThan(files.drain.mock.invocationCallOrder[0]);
  expect(last()).toMatchObject({ status: { mode: 'idle' }, filesWaiting: 1, storageFull: true });
});

it('an offline drain backs off like a failed sync', async () => {
  files.drain.mockImplementationOnce(async () => Promise.reject(new Offline()));
  ctl.turnOn('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'offline', retryAt: 1_000_000 + 30_000 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(files.drain).toHaveBeenCalledTimes(2);
  expect(last().status.mode).toBe('idle');
});

it('a failed sync does not drain files', async () => {
  script.push(async () => Promise.reject(new Offline()));
  ctl.turnOn('u1');
  await flush();
  expect(files.drain).not.toHaveBeenCalled();
});