// India has no daylight saving: day bounds are exactly +05:30 midnights.
process.env.TZ = 'Asia/Kolkata';

import { expect, it } from 'vitest';
import { dayBounds, GoogleCalendar, toCalendarEvent } from '../../../src/main/connectors/google-calendar';
import { Revoked } from '../../../src/main/connectors/client';
import { AuthExpired } from '../../../src/main/sync/http-server';

const NOW = new Date(2026, 9, 29, 14, 30); // 29 Oct 2026, 14:30 local

it('dayBounds are local midnight to the next midnight, with the offset', () => {
  expect(dayBounds(NOW)).toEqual({ timeMin: '2026-10-29T00:00:00+05:30', timeMax: '2026-10-30T00:00:00+05:30' });
});

it('a timed event', () => {
  expect(
    toCalendarEvent({
      id: 'e1',
      summary: 'Standup',
      htmlLink: 'https://www.google.com/calendar/event?eid=1',
      start: { dateTime: '2026-10-29T10:00:00+05:30' },
      end: { dateTime: '2026-10-29T10:15:00+05:30' },
    }),
  ).toEqual({
    id: 'e1',
    title: 'Standup',
    start: Date.parse('2026-10-29T10:00:00+05:30'),
    end: Date.parse('2026-10-29T10:15:00+05:30'),
    allDay: false,
    link: 'https://www.google.com/calendar/event?eid=1',
  });
});

it('an all-day event spans local midnights', () => {
  const e = toCalendarEvent({ id: 'e2', summary: 'Holiday', htmlLink: 'l', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } });
  expect(e).toMatchObject({ allDay: true, start: new Date(2026, 9, 29).getTime(), end: new Date(2026, 9, 30).getTime() });
});

it('a multi-day event overlapping today keeps its real start', () => {
  const e = toCalendarEvent({ id: 'e3', summary: 'Trip', htmlLink: 'l', start: { date: '2026-10-27' }, end: { date: '2026-11-01' } });
  expect(e?.start).toBe(new Date(2026, 9, 27).getTime());
  expect(e?.end).toBe(new Date(2026, 10, 1).getTime());
});

it('no summary is "(No title)"; cancelled or startless is null', () => {
  expect(toCalendarEvent({ id: 'e4', htmlLink: 'l', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } })?.title).toBe('(No title)');
  expect(toCalendarEvent({ id: 'e5', status: 'cancelled', start: { date: '2026-10-29' } })).toBeNull();
  expect(toCalendarEvent({ id: 'e6' })).toBeNull();
  expect(toCalendarEvent(null)).toBeNull();
});

function calendar(responses: Array<() => Response>) {
  const urls: string[] = [];
  const auths: string[] = [];
  const inits: RequestInit[] = [];
  let tokens = 0;
  const fetch = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    inits.push(init ?? {});
    auths.push((init?.headers as Record<string, string>).authorization);
    return responses.shift()!();
  }) as typeof globalThis.fetch;
  const t = { now: 1_000_000 };
  const cal = new GoogleCalendar({
    token: async () => ({ accessToken: `at${++tokens}`, expiresIn: 3600 }),
    fetch,
    baseUrl: 'https://cal.test/v3',
    now: () => t.now,
  });
  return { cal, urls, auths, inits, tokens: () => tokens, t };
}

const items = (list: unknown[]) => () => new Response(JSON.stringify({ items: list }), { status: 200 });

it('todayEvents asks for the primary calendar today, expanded and ordered', async () => {
  const { cal, urls, auths } = calendar([items([{ id: 'a', summary: 'A', htmlLink: 'l', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }])]);
  const events = await cal.todayEvents(NOW);
  expect(events.map((e) => e.id)).toEqual(['a']);
  const u = new URL(urls[0]);
  expect(u.origin + u.pathname).toBe('https://cal.test/v3/calendars/primary/events');
  expect(Object.fromEntries(u.searchParams)).toEqual({
    timeMin: '2026-10-29T00:00:00+05:30',
    timeMax: '2026-10-30T00:00:00+05:30',
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  expect(auths[0]).toBe('Bearer at1');
});

it('the access token is reused until a minute before it expires', async () => {
  const { cal, tokens, t } = calendar([items([]), items([]), items([])]);
  await cal.todayEvents(NOW);
  t.now += 3_539_000; // 61 s left
  await cal.todayEvents(NOW);
  expect(tokens()).toBe(1);
  t.now += 2_000; // 59 s left
  await cal.todayEvents(NOW);
  expect(tokens()).toBe(2);
});

it('a 401 from Google gets a new token and retries once', async () => {
  const { cal, auths } = calendar([() => new Response('', { status: 401 }), items([])]);
  await cal.todayEvents(NOW);
  expect(auths).toEqual(['Bearer at1', 'Bearer at2']);
});

it('a second 401 is AuthExpired', async () => {
  const { cal } = calendar([() => new Response('', { status: 401 }), () => new Response('', { status: 401 })]);
  await expect(cal.todayEvents(NOW)).rejects.toBeInstanceOf(AuthExpired);
});

it('clear forgets the token', async () => {
  const { cal, tokens } = calendar([items([]), items([])]);
  await cal.todayEvents(NOW);
  cal.clear();
  await cal.todayEvents(NOW);
  expect(tokens()).toBe(2);
});

it('a token fetched before clear() is not kept', async () => {
  let release!: () => void;
  let n = 0;
  const fetch = (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof globalThis.fetch;
  const cal = new GoogleCalendar({
    token: () => (++n === 1 ? new Promise((r) => (release = () => r({ accessToken: 'old', expiresIn: 3600 }))) : Promise.resolve({ accessToken: 'new', expiresIn: 3600 })),
    fetch,
    baseUrl: 'https://cal.test/v3',
  });
  const first = cal.todayEvents(NOW);
  cal.clear(); // signed out while the token was on its way
  release();
  await first;
  await cal.todayEvents(NOW);
  expect(n).toBe(2);
});

const one = (item: unknown) => () => new Response(JSON.stringify(item), { status: 200 });
const LUNCH = { id: 'n1', summary: 'Lunch', htmlLink: 'l', start: { dateTime: '2026-10-30T13:00:00+05:30' }, end: { dateTime: '2026-10-30T14:00:00+05:30' } };

it('events sends the range and follows pages up to 4', async () => {
  const page = () => new Response(JSON.stringify({ items: [], nextPageToken: 'more' }), { status: 200 });
  const { cal, urls } = calendar([page, page, page, page, page]);
  await cal.events(new Date(2026, 8, 28), new Date(2026, 10, 9));
  expect(urls).toHaveLength(4);
  const first = new URL(urls[0]).searchParams;
  expect(first.get('timeMin')).toBe('2026-09-28T00:00:00+05:30');
  expect(first.get('timeMax')).toBe('2026-11-09T00:00:00+05:30');
  expect(first.get('maxResults')).toBe('250');
  expect(first.has('pageToken')).toBe(false);
  expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('more');
});

it('create sends a timed event with the time zone', async () => {
  const { cal, urls, inits } = calendar([one(LUNCH)]);
  const e = await cal.create({ title: 'Lunch', allDay: false, start: new Date(2026, 9, 30, 13).getTime(), end: new Date(2026, 9, 30, 14).getTime() });
  expect(urls[0]).toBe('https://cal.test/v3/calendars/primary/events');
  expect(inits[0].method).toBe('POST');
  expect(JSON.parse(String(inits[0].body))).toEqual({
    summary: 'Lunch',
    start: { dateTime: '2026-10-30T13:00:00+05:30', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    end: { dateTime: '2026-10-30T14:00:00+05:30', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
  });
  expect(e).toMatchObject({ id: 'n1', title: 'Lunch' });
});

it('create sends an all-day event with an exclusive end date', async () => {
  const { cal, inits } = calendar([one({ ...LUNCH, start: { date: '2026-10-30' }, end: { date: '2026-11-01' } })]);
  await cal.create({ title: 'Trip', allDay: true, start: new Date(2026, 9, 30).getTime(), end: new Date(2026, 10, 1).getTime() });
  expect(JSON.parse(String(inits[0].body))).toEqual({ summary: 'Trip', start: { date: '2026-10-30' }, end: { date: '2026-11-01' } });
});

it('quickAdd posts the text', async () => {
  const { cal, urls, inits } = calendar([one(LUNCH)]);
  expect((await cal.quickAdd('Lunch tomorrow 1pm'))?.title).toBe('Lunch');
  expect(urls[0]).toBe('https://cal.test/v3/calendars/primary/events/quickAdd?text=Lunch+tomorrow+1pm');
  expect(inits[0].method).toBe('POST');
});

it('403 is Revoked', async () => {
  const { cal } = calendar([() => new Response('', { status: 403 })]);
  await expect(cal.quickAdd('x')).rejects.toBeInstanceOf(Revoked);
});

it('a 401 on create retries once with a fresh token', async () => {
  const { cal, auths } = calendar([() => new Response('', { status: 401 }), one(LUNCH)]);
  await cal.create({ title: 'Lunch', allDay: false, start: 1, end: 2 });
  expect(auths).toEqual(['Bearer at1', 'Bearer at2']);
});

it('toCalendarEvent keeps location and caps description at 2000', () => {
  const e = toCalendarEvent({ ...LUNCH, location: ' Cafe ', description: 'x'.repeat(2500) });
  expect(e?.location).toBe('Cafe');
  expect(e?.description).toHaveLength(2000);
  expect(toCalendarEvent(LUNCH)).not.toHaveProperty('location');
});
