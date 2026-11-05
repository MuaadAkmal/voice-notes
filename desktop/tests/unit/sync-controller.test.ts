import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/main/settings';
import { SyncController, type SyncView } from '../../src/main/sync/controller';
import { AuthExpired, NotSignedIn, Offline, Rejected } from '../../src/main/sync/http-server';

const NONE = { notes: false, pages: false, folders: false, prefs: false };

class FakeState {
  account: string | null = null;
  rec = false;
  accountId = () => this.account;
  setAccountId = (id: string | null) => void (this.account = id);
  enabled = () => this.rec;
}

let state: FakeState;
let user: string | null;
let views: SyncView[];
let changes: unknown[];
let script: (() => Promise<typeof NONE>)[];
let engine: {
  sync: ReturnType<typeof vi.fn<() => Promise<typeof NONE>>>;
  enable: ReturnType<typeof vi.fn<() => void>>;
};
let refreshed: number;
let files: { drain: ReturnType<typeof vi.fn<(shouldYield?: () => boolean) => Promise<{ storageFull: boolean }>>>; waiting: () => number; left: number };
let ctl: SyncController;
let pings: { update: ReturnType<typeof vi.fn<(userId: string | null) => void>> };
let synced: number;

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
  synced = 0;
  files = { drain: vi.fn(async () => ({ storageFull: false })), waiting: () => files.left, left: 0 };
  engine = {
    sync: vi.fn<() => Promise<typeof NONE>>(async () => (script.shift() ?? (async () => NONE))()),
    enable: vi.fn<() => void>(() => void (state.rec = true)),
  };
  pings = { update: vi.fn<(userId: string | null) => void>() };
  ctl = new SyncController({
    pings,
    engine,
    state,
    settings: () => DEFAULT_SETTINGS,
    currentUser: () => user,
    refreshSession: async () => void refreshed++,
    onView: (v) => views.push(v),
    onChanged: (c) => changes.push(c),
    onSynced: () => void synced++,
    files,
  });
  ctl.start();
});
afterEach(() => {
  ctl.stop();
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

it('is off until bound to the profile', () => {
  expect(ctl.view()).toEqual({ status: { mode: 'off' }, filesWaiting: 0, storageFull: false, storage: null });
  expect(engine.sync).not.toHaveBeenCalled();
});

it('bind sets the account, enables once and syncs', async () => {
  ctl.bind('u1');
  await flush();
  expect(state.account).toBe('u1');
  expect(engine.enable).toHaveBeenCalledTimes(1);
  expect(engine.sync).toHaveBeenCalledTimes(1);
  expect(last()).toEqual({ status: { mode: 'idle', lastSyncedAt: 1_000_000 }, filesWaiting: 0, storageFull: false, storage: null });
  ctl.bind('u1');
  await flush();
  expect(engine.enable).toHaveBeenCalledTimes(1);
});

it('asks for the storage numbers after a sync, again after files move, and shrugs off a failure', async () => {
  ctl.stop();
  const seen: { used: number; limit: number }[] = [];
  let answer: () => Promise<{ used: number; limit: number }> = async () => ({ used: 180, limit: 250 });
  const storage = vi.fn(() => answer());
  ctl = new SyncController({
    pings,
    engine,
    state,
    settings: () => DEFAULT_SETTINGS,
    currentUser: () => user,
    refreshSession: async () => undefined,
    onView: (v) => views.push(v),
    onChanged: () => undefined,
    files,
    storage,
    onStorage: (u) => seen.push(u),
  });
  ctl.start();
  ctl.bind('u1');
  await flush();
  expect(last().storage).toEqual({ used: 180, limit: 250 });
  expect(seen).toEqual([{ used: 180, limit: 250 }]);

  // Nothing moved and it's been under 30 min: not asked again.
  ctl.syncNow();
  await flush();
  expect(storage).toHaveBeenCalledTimes(1);

  // Files uploaded: asked again. A failure keeps the last numbers.
  files.left = 2;
  files.drain.mockImplementationOnce(async () => ((files.left = 0), { storageFull: false }));
  answer = async () => Promise.reject(new Offline());
  ctl.syncNow();
  await flush();
  expect(storage).toHaveBeenCalledTimes(2);
  expect(last().storage).toEqual({ used: 180, limit: 250 });
});

it('says when a sync went through, and not when it failed', async () => {
  script = [async () => Promise.reject(new Offline())];
  ctl.bind('u1');
  await flush();
  expect(synced).toBe(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(synced).toBe(1);
});

it('a failure in what runs after a sync is not a sync error', async () => {
  ctl.stop();
  const errors: SyncView[] = [];
  ctl = new SyncController({
    pings, engine, state, settings: () => DEFAULT_SETTINGS, currentUser: () => user, refreshSession: async () => undefined,
    onView: (v) => errors.push(v), onChanged: () => undefined, files,
    onSynced: () => {
      throw new Error('starter pages failed');
    },
  });
  ctl.start();
  ctl.bind('u1');
  await flush();
  expect(errors.at(-1)!.status.mode).toBe('idle');
  expect(files.drain).toHaveBeenCalled();
});

it('bind refuses a different account', async () => {
  state.account = 'u1';
  state.rec = true;
  user = 'u2';
  ctl.bind('u2');
  await flush();
  expect(engine.sync).not.toHaveBeenCalled();
  expect(state.account).toBe('u1');
  expect(ctl.view().status).toEqual({ mode: 'off' });
});

it('signed in as another user does not sync', async () => {
  ctl.bind('u1');
  await flush();
  engine.sync.mockClear();
  user = 'u2';
  ctl.onAccountChanged();
  ctl.syncNow();
  await flush();
  expect(engine.sync).not.toHaveBeenCalled();
  expect(ctl.view().status).toEqual({ mode: 'off' });
});

it('a burst of edits syncs once, 3 s after the last', async () => {
  ctl.bind('u1');
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
  ctl.bind('u1');
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
  ctl.bind('u1');
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
  ctl.bind('u1');
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
  ctl.bind('u1');
  await flush();
  const calls = engine.sync.mock.calls.length;
  ctl.onResume();
  await flush();
  expect(engine.sync.mock.calls.length).toBe(calls + 1);
});

it('an expired session is refreshed once; if that fails, it asks to sign in again', async () => {
  script = [async () => Promise.reject(new AuthExpired()), async () => NONE];
  ctl.bind('u1');
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
  ctl.bind('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'error', message: 'Invalid change' });
  const calls = engine.sync.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(engine.sync.mock.calls.length).toBe(calls);
});

it('signing out pauses; signing back in with the same account resumes', async () => {
  ctl.bind('u1');
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

it('a sync asked for while one is running happens right after it', async () => {
  let finish!: () => void;
  script = [() => new Promise((r) => (finish = () => r(NONE)))];
  ctl.bind('u1');
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  ctl.syncNow(); // e.g. Sync now, or an edit saved during the run
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(2);
});

it('what a pull changed is passed on', async () => {
  script = [async () => ({ ...NONE, pages: true })];
  ctl.bind('u1');
  await flush();
  expect(changes).toEqual([{ ...NONE, pages: true }]);
});

it('no session at sync time pauses instead of erroring', async () => {
  script = [async () => Promise.reject(new NotSignedIn())];
  ctl.bind('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'paused', reason: 'signed-out' });
});

it('after a successful sync the file queue drains and the view shows filesWaiting and storageFull', async () => {
  files.left = 3;
  files.drain.mockImplementation(async () => {
    files.left = 1;
    return { storageFull: true };
  });
  ctl.bind('u1');
  await flush();
  expect(files.drain).toHaveBeenCalledTimes(1);
  expect(engine.sync.mock.invocationCallOrder[0]).toBeLessThan(files.drain.mock.invocationCallOrder[0]);
  expect(last()).toMatchObject({ status: { mode: 'idle' }, filesWaiting: 1, storageFull: true });
});

it('a file failure after the rows synced keeps sync idle, with no backoff for the rows', async () => {
  files.drain.mockImplementationOnce(async () => Promise.reject(new Offline()));
  ctl.bind('u1');
  await flush();
  expect(last().status).toEqual({ mode: 'idle', lastSyncedAt: 1_000_000 });
  engine.sync.mockClear();
  ctl.onLocalChange(); // not held back by a retry timer
  await vi.advanceTimersByTimeAsync(3000);
  expect(engine.sync).toHaveBeenCalledTimes(1);
  expect(files.drain).toHaveBeenCalledTimes(2);
});

it('an edit during a long upload asks the drain to make way', async () => {
  let yielded = false;
  files.drain.mockImplementationOnce(async (shouldYield?: () => boolean) => {
    expect(shouldYield?.()).toBe(false);
    ctl.syncNow(); // what an edit's sync does 3 s later: it waits on this run
    yielded = !!shouldYield?.();
    return { storageFull: false };
  });
  ctl.bind('u1');
  await flush();
  await flush();
  expect(yielded).toBe(true);
  expect(engine.sync).toHaveBeenCalledTimes(2); // the edit's rows went right after
});

it('a failed sync does not drain files', async () => {
  script.push(async () => Promise.reject(new Offline()));
  ctl.bind('u1');
  await flush();
  expect(files.drain).not.toHaveBeenCalled();
});
const lastPing = () => pings.update.mock.calls.at(-1)?.[0];

it('pings follow sign-in', async () => {
  expect(lastPing()).toBe(null); // started, not bound to this account yet
  ctl.bind('u1');
  await flush();
  expect(lastPing()).toBe('u1');
  user = null;
  ctl.onAccountChanged();
  expect(lastPing()).toBe(null);
  user = 'u1';
  ctl.onAccountChanged();
  expect(lastPing()).toBe('u1');
  ctl.stop();
  expect(lastPing()).toBe(null);
});

it('onRemoteChange syncs now', async () => {
  ctl.bind('u1');
  await flush();
  engine.sync.mockClear();
  ctl.onRemoteChange();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(1);
});

it('a ping waits for a pending retry', async () => {
  script = [async () => Promise.reject(new Offline())];
  ctl.bind('u1');
  await flush(); // fails → retry in 30 s
  const calls = engine.sync.mock.calls.length;
  ctl.onRemoteChange();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(engine.sync.mock.calls.length).toBe(calls);
  await vi.advanceTimersByTimeAsync(1);
  expect(engine.sync.mock.calls.length).toBe(calls + 1);
});

it('pings during a run cost one rerun', async () => {
  let release!: () => void;
  script = [() => new Promise((r) => (release = () => r(NONE)))];
  ctl.bind('u1');
  await flush();
  ctl.onRemoteChange();
  ctl.onRemoteChange();
  ctl.onRemoteChange();
  release();
  await flush();
  await flush();
  expect(engine.sync).toHaveBeenCalledTimes(2);
});
it('flush waits for a sync that was already running and the one after it', async () => {
  const releases: (() => void)[] = [];
  script = [() => new Promise((r) => releases.push(() => r(NONE))), () => new Promise((r) => releases.push(() => r(NONE)))];
  ctl.bind('u1');
  await flush();
  let done = false;
  void ctl.flush().then(() => (done = true));
  await flush();
  releases[0]();
  await flush();
  expect(done).toBe(false); // the flush's own run is going now
  releases[1]();
  await flush();
  expect(done).toBe(true);
  expect(engine.sync).toHaveBeenCalledTimes(2);
});

it('flush when it cannot sync returns at once', async () => {
  await expect(ctl.flush()).resolves.toBeUndefined();
  expect(engine.sync).not.toHaveBeenCalled();
});
