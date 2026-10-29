import { expect, it } from 'vitest';
import type { CalendarEvent, ConnectorsInfo } from '../../../src/shared/channels';
import type { ConnectorsStatus } from '../../../src/shared/connectors/protocol';
import { NotConnected, Revoked } from '../../../src/main/connectors/client';
import { ConnectorsService } from '../../../src/main/connectors/service';
import { Offline } from '../../../src/main/sync/http-server';

const CONNECTED: ConnectorsStatus = { google: { email: 'cal@gmail.com', connectedAt: 1 } };
const NONE: ConnectorsStatus = { google: null };
const EVENT: CalendarEvent = { id: 'e', title: 'T', start: 1, end: 2, allDay: false, link: 'l' };

function setup(o: { signedIn?: boolean; statuses?: ConnectorsStatus[]; events?: () => Promise<CalendarEvent[]>; timeoutMs?: number } = {}) {
  const seen: ConnectorsInfo[] = [];
  const calls = { start: 0, status: 0, disconnect: 0, opened: [] as string[], focused: 0, cleared: 0 };
  const statuses = [...(o.statuses ?? [NONE])];
  const auth = { signedIn: o.signedIn ?? true };
  const clock = { t: 0 };
  const svc = new ConnectorsService({
    client: {
      start: async () => (calls.start++, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x' }),
      status: async () => (calls.status++, statuses.length > 1 ? statuses.shift()! : statuses[0]),
      disconnect: async () => void calls.disconnect++,
    },
    calendar: { todayEvents: o.events ?? (async () => [EVENT]), clear: () => void calls.cleared++ },
    signedIn: () => auth.signedIn,
    openExternal: async (u) => void calls.opened.push(u),
    focusApp: () => void calls.focused++,
    onChange: (i) => void seen.push(i),
    pollMs: 1,
    timeoutMs: o.timeoutMs ?? 5_000,
    now: () => clock.t,
  });
  return { svc, seen, calls, auth, clock, statuses };
}

it('signed out is signed-out, without asking the server', async () => {
  const { svc, calls } = setup({ signedIn: false });
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

it('connect opens the URL and polls until connected, then focuses the app', async () => {
  const { svc, calls, seen } = setup({ statuses: [NONE, NONE, CONNECTED] });
  await svc.connect();
  expect(calls.opened).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?x']);
  expect(svc.current()).toEqual({ state: 'connected', email: 'cal@gmail.com' });
  expect(seen.map((s) => s.state)).toContain('connecting');
  expect(calls.focused).toBe(1);
});

it('a second connect joins the first', async () => {
  const { svc, calls } = setup({ statuses: [NONE, CONNECTED] });
  await Promise.all([svc.connect(), svc.connect()]);
  expect(calls.start).toBe(1);
});

it('cancel stops polling without an error', async () => {
  const { svc } = setup({ statuses: [NONE] });
  const p = svc.connect();
  await new Promise((r) => setTimeout(r, 5));
  svc.cancel();
  await p;
  expect(svc.current()).toEqual({ state: 'disconnected' });
});

it('no answer in time is an error', async () => {
  const { svc } = setup({ statuses: [NONE], timeoutMs: 10 });
  await svc.connect();
  expect(svc.current()).toEqual({ state: 'disconnected', error: "Didn't hear back from Google. Try again." });
});

it('sign-out while connecting stops polling and forgets the token', async () => {
  const { svc, auth, calls } = setup({ statuses: [NONE] });
  const p = svc.connect();
  await new Promise((r) => setTimeout(r, 5));
  auth.signedIn = false;
  svc.onAccountChanged();
  await p;
  expect(svc.current()).toEqual({ state: 'signed-out' });
  expect(calls.cleared).toBeGreaterThan(0);
  const polled = calls.status;
  await new Promise((r) => setTimeout(r, 10));
  expect(calls.status).toBe(polled);
});

it('Revoked from today is needs-reconnect', async () => {
  const { svc } = setup({ statuses: [CONNECTED], events: async () => Promise.reject(new Revoked()) });
  await svc.refresh();
  expect(await svc.today(new Date())).toEqual({ error: 'needs-reconnect' });
  expect(svc.current()).toEqual({ state: 'needs-reconnect' });
});

it('today maps the other errors', async () => {
  expect(await setup({ events: async () => Promise.reject(new Offline()) }).svc.today(new Date())).toEqual({ error: 'offline' });
  const nc = setup({ statuses: [CONNECTED], events: async () => Promise.reject(new NotConnected()) });
  await nc.svc.refresh();
  expect(await nc.svc.today(new Date())).toEqual({ error: 'not-connected' });
  expect(nc.svc.current()).toEqual({ state: 'disconnected' });
  expect(await setup({ events: async () => Promise.reject(new Error('x')) }).svc.today(new Date())).toEqual({ error: 'failed' });
  expect(await setup({ signedIn: false }).svc.today(new Date())).toEqual({ error: 'signed-out' });
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
  await new Promise((r) => setTimeout(r, 1));
  expect(calls.status).toBe(1);
  clock.t += 60_001;
  svc.onFocus();
  await new Promise((r) => setTimeout(r, 1));
  expect(calls.status).toBe(2);
});
