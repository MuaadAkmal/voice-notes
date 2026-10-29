// India has no daylight saving: day bounds are exactly +05:30 midnights.
process.env.TZ = 'Asia/Kolkata';

import { expect, it } from 'vitest';
import { dayBounds, GoogleCalendar, toCalendarEvent } from '../../../src/main/connectors/google-calendar';
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
  let tokens = 0;
  const fetch = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
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
  return { cal, urls, auths, tokens: () => tokens, t };
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
    maxResults: '50',
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
