import { expect, it } from 'vitest';
import type { CalendarEvent, ConnectorsInfo } from '../../../src/shared/channels';
import type { CallbackResult, ConnectorsStatus } from '../../../src/shared/connectors/protocol';
import { NotConnected, Revoked } from '../../../src/main/connectors/client';
import { ConnectorsService } from '../../../src/main/connectors/service';
import { Offline } from '../../../src/main/sync/http-server';

const CONNECTED: ConnectorsStatus = { google: { email: 'cal@gmail.com', connectedAt: 1 } };
const NONE: ConnectorsStatus = { google: null };
const EVENT: CalendarEvent = { id: 'e', title: 'T', start: 1, end: 2, allDay: false, link: 'l' };
const A = 'user-a';
const B = 'user-b';

type Opts = {
  user?: string | null;
  statuses?: ConnectorsStatus[];
  /** What polling the consent attempt answers, in turn; the last one repeats. */
  attempts?: (CallbackResult | null)[];
  events?: () => Promise<CalendarEvent[]>;
  timeoutMs?: number;
  status?: () => Promise<ConnectorsStatus>;
};

function setup(o: Opts = {}) {
  const seen: ConnectorsInfo[] = [];
  const calls = { start: 0, status: 0, attempt: [] as string[], disconnect: 0, opened: [] as string[], focused: 0, cleared: 0 };
  const statuses = [...(o.statuses ?? [NONE])];
  const attempts = [...(o.attempts ?? [null])];
  const auth = { user: o.user === undefined ? A : o.user };
  const clock = { t: 0 };
  const svc = new ConnectorsService({
    client: {
      start: async () => (calls.start++, { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=st1&x=1' }),
      status:
        o.status ??
        (async () => {
          calls.status++;
          return statuses.length > 1 ? statuses.shift()! : statuses[0];
        }),
      attempt: async (state) => {
        calls.attempt.push(state);
        const result = attempts.length > 1 ? attempts.shift()! : attempts[0];
        // Like the server: a connected attempt is also a connected status.
        if (result === 'connected') statuses.splice(0, statuses.length, CONNECTED);
        return { result };
      },
      disconnect: async () => void calls.disconnect++,
    },
    calendar: { todayEvents: o.events ?? (async () => [EVENT]), clear: () => void calls.cleared++ },
    userId: () => auth.user,
    openExternal: async (u) => void calls.opened.push(u),
    focusApp: () => void calls.focused++,
    onChange: (i) => void seen.push(i),
    pollMs: 1,
    timeoutMs: o.timeoutMs ?? 5_000,
    now: () => clock.t,
  });
  return { svc, seen, calls, auth, clock, statuses };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

it('signed out is signed-out, without asking the server', async () => {
  const { svc, calls } = setup({ user: null });
  await svc.refresh();
  expect(svc.current()).toEqual({ state: 'signed-out' });
  expect(calls.status).toBe(0);
});

it('refresh maps the status', async () => {
  const a = setup({ statuses: [CONNECTED] });
  await a.svc.refresh();
  expect(a.svc.current()).toEqual({ state: 'connected', email: 'cal@gmail.com' });
  const b = setup({ statuses: [NONE] });
  await b.svc.refresh();
  expect(b.svc.current()).toEqual({ state: 'disconnected' });
});

it('an unchanged state is not published again', async () => {
  const { svc, seen } = setup({ events: async () => Promise.reject(new NotConnected()) });
  await svc.refresh();
  await svc.today(new Date());
  await svc.today(new Date());
  expect(seen).toEqual([{ state: 'disconnected' }]);
});

it('connect opens the URL and polls its attempt until connected, then focuses the app', async () => {
  const { svc, calls, seen } = setup({ attempts: [null, null, 'connected'] });
  await svc.connect();
  expect(calls.opened).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?state=st1&x=1']);
  expect(calls.attempt.every((s) => s === 'st1')).toBe(true);
  expect(svc.current()).toEqual({ state: 'connected', email: 'cal@gmail.com' });
  expect(seen.map((s) => s.state)).toContain('connecting');
  expect(calls.focused).toBe(1);
});

it('a refused consent ends at once with its reason', async () => {
  const unticked = setup({ attempts: [null, 'no-calendar'], timeoutMs: 60_000 });
  await unticked.svc.connect();
  expect(unticked.svc.current()).toEqual({
    state: 'disconnected',
    error: "Calendar access wasn't granted. Tick the calendar box and try again.",
  });
  const denied = setup({ attempts: ['denied'], timeoutMs: 60_000 });
  await denied.svc.connect();
  expect(denied.svc.current()).toEqual({ state: 'disconnected', error: "Google Calendar wasn't connected." });
  const failed = setup({ attempts: ['failed'], timeoutMs: 60_000 });
  await failed.svc.connect();
  expect(failed.svc.current()).toEqual({ state: 'disconnected', error: 'Something went wrong at Google. Try again.' });
});

it('a second connect joins the first', async () => {
  const { svc, calls } = setup({ attempts: [null, 'connected'] });
  await Promise.all([svc.connect(), svc.connect()]);
  expect(calls.start).toBe(1);
});

it('cancel stops polling without an error', async () => {
  const { svc } = setup();
  const p = svc.connect();
  await tick();
  svc.cancel();
  await p;
  expect(svc.current()).toEqual({ state: 'disconnected' });
});

it('no answer in time is an error', async () => {
  const { svc } = setup({ timeoutMs: 10 });
  await svc.connect();
  expect(svc.current()).toEqual({ state: 'disconnected', error: "Didn't hear back from Google. Try again." });
});

it('sign-out while connecting stops polling and forgets the token', async () => {
  const { svc, auth, calls } = setup();
  const p = svc.connect();
  await tick();
  auth.user = null;
  svc.onAccountChanged();
  await p;
  await tick();
  expect(svc.current()).toEqual({ state: 'signed-out' });
  expect(calls.cleared).toBeGreaterThan(0);
  const polled = calls.attempt.length;
  await tick(10);
  expect(calls.attempt.length).toBe(polled);
});

it('switching account while connecting ends on the new account\'s state', async () => {
  const { svc, auth } = setup({ statuses: [NONE] });
  const p = svc.connect();
  await tick();
  auth.user = B;
  svc.onAccountChanged();
  await p;
  await tick();
  expect(svc.current()).toEqual({ state: 'disconnected' });
});

it('the same user signing in again does not disturb a connect', async () => {
  const { svc, auth, calls } = setup({ attempts: [null, null, null, 'connected'] });
  await svc.refresh();
  const p = svc.connect();
  await tick(1);
  auth.user = A; // e.g. USER_UPDATED: same account
  svc.onAccountChanged();
  await p;
  expect(svc.current()).toEqual({ state: 'connected', email: 'cal@gmail.com' });
  expect(calls.cleared).toBe(0);
});

it('a refresh that resolves after sign-out is dropped', async () => {
  let answer!: (s: ConnectorsStatus) => void;
  const { svc, auth } = setup({ status: () => new Promise((r) => (answer = r)) });
  const p = svc.refresh();
  auth.user = null;
  svc.onAccountChanged();
  answer(CONNECTED);
  await p;
  await tick();
  expect(svc.current()).toEqual({ state: 'signed-out' });
});

it('Revoked is needs-reconnect, and it stays until a connect succeeds', async () => {
  let revoked = true;
  const { svc } = setup({
    statuses: [CONNECTED, NONE],
    attempts: ['connected'],
    events: async () => Promise.reject(revoked ? new Revoked() : new NotConnected()),
  });
  await svc.refresh();
  expect(await svc.today(new Date())).toEqual({ error: 'needs-reconnect' });
  expect(svc.current()).toEqual({ state: 'needs-reconnect' });
  revoked = false; // the server deleted the row: now it says not connected
  expect(await svc.today(new Date())).toEqual({ error: 'needs-reconnect' });
  await svc.refresh(); // status: google null
  expect(svc.current()).toEqual({ state: 'needs-reconnect' });
  await svc.connect();
  expect(svc.current()).toEqual({ state: 'connected', email: 'cal@gmail.com' });
});

it('another account clears needs-reconnect', async () => {
  const { svc, auth } = setup({ statuses: [CONNECTED, NONE], events: async () => Promise.reject(new Revoked()) });
  await svc.refresh();
  await svc.today(new Date());
  auth.user = B;
  svc.onAccountChanged();
  await tick();
  expect(svc.current()).toEqual({ state: 'disconnected' });
});

it('today maps the other errors', async () => {
  expect(await setup({ events: async () => Promise.reject(new Offline()) }).svc.today(new Date())).toEqual({ error: 'offline' });
  const nc = setup({ statuses: [CONNECTED], events: async () => Promise.reject(new NotConnected()) });
  await nc.svc.refresh();
  expect(await nc.svc.today(new Date())).toEqual({ error: 'not-connected' });
  expect(nc.svc.current()).toEqual({ state: 'disconnected' });
  expect(await setup({ events: async () => Promise.reject(new Error('x')) }).svc.today(new Date())).toEqual({ error: 'failed' });
  expect(await setup({ user: null }).svc.today(new Date())).toEqual({ error: 'signed-out' });
});

it('today returns the events', async () => {
  expect(await setup().svc.today(new Date())).toEqual({ events: [EVENT] });
});

it('disconnect tells the server, forgets the token and is disconnected', async () => {
  const { svc, calls } = setup({ statuses: [CONNECTED] });
  await svc.refresh();
  await svc.disconnect();
  expect([calls.disconnect, calls.cleared]).toEqual([1, 1]);
  expect(svc.current()).toEqual({ state: 'disconnected' });
});

it('onFocus refreshes at most once a minute', async () => {
  const { svc, calls, clock } = setup();
  svc.onFocus();
  svc.onFocus();
  await tick(1);
  expect(calls.status).toBe(1);
  clock.t += 60_001;
  svc.onFocus();
  await tick(1);
  expect(calls.status).toBe(2);
});
