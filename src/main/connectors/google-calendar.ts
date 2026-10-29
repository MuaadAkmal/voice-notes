import type { CalendarEvent, NewEvent } from '../../shared/channels';
import type { TokenResponse } from '../../shared/connectors/protocol';
import { AuthExpired, Offline } from '../sync/http-server';
import { Revoked } from './client';

// The user's primary Google Calendar (read a range, add events), called from main with a short-lived access
// token from the `connectors` function (kept in memory only).

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const EARLY_MS = 60_000; // a token this close to expiring is fetched again
const PAGE_SIZE = 250;
const MAX_PAGES = 4; // 1000 events: far more than a month grid shows
const MAX_DESCRIPTION = 2000;

type Deps = {
  token(): Promise<TokenResponse>;
  fetch: typeof fetch;
  baseUrl?: string;
  now?(): number;
};

export class GoogleCalendar {
  private cached: { accessToken: string; expiresAt: number } | null = null;
  private generation = 0; // bumped by clear(): a token already on its way is then not kept

  constructor(private readonly d: Deps) {}

  todayEvents(now: Date): Promise<CalendarEvent[]> {
    const { timeMin, timeMax } = dayBounds(now);
    return this.list(timeMin, timeMax);
  }

  /** Events overlapping [from, to), recurring ones expanded, in start order. */
  events(from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.list(rfc3339(from), rfc3339(to));
  }

  async create(e: NewEvent): Promise<CalendarEvent> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const at = (ms: number) => (e.allDay ? { date: ymd(new Date(ms)) } : { dateTime: rfc3339(new Date(ms)), timeZone });
    const body = { summary: e.title, start: at(e.start), end: at(e.end) }; // Google's all-day end date is exclusive too
    return this.added(await this.send('POST', `${this.base()}/calendars/primary/events`, body));
  }

  /** Google's own parsing of "Lunch tomorrow 1pm". */
  async quickAdd(text: string): Promise<CalendarEvent> {
    const url = `${this.base()}/calendars/primary/events/quickAdd?${new URLSearchParams({ text })}`;
    return this.added(await this.send('POST', url));
  }

  private async list(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const out: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(PAGE_SIZE) });
      if (pageToken) params.set('pageToken', pageToken);
      const body = (await this.send('GET', `${this.base()}/calendars/primary/events?${params}`)) as { items?: unknown[]; nextPageToken?: string };
      for (const item of body.items ?? []) {
        const e = toCalendarEvent(item);
        if (e) out.push(e);
      }
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  private added(item: unknown): CalendarEvent {
    const e = toCalendarEvent(item);
    if (!e) throw new Error('Google Calendar answered without the event');
    return e;
  }

  private base(): string {
    return this.d.baseUrl ?? CALENDAR_API;
  }

  /** One call with the cached token; a 401 gets one more try with a fresh one. Answers the parsed JSON. */
  private async send(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
    let res = await this.fetchWithToken(method, url, body);
    if (res.status === 401) {
      this.cached = null; // revoked or rotated early: one more try with a fresh token
      res = await this.fetchWithToken(method, url, body);
      if (res.status === 401) throw new AuthExpired();
    }
    if (res.status === 403) throw new Revoked(); // the calendar permission is gone
    if (!res.ok) throw new Error(`Google Calendar answered ${res.status}`);
    return res.json();
  }

  clear(): void {
    this.cached = null;
    this.generation++;
  }

  private async fetchWithToken(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await this.d.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Offline();
    }
  }

  private async accessToken(): Promise<string> {
    const now = this.d.now?.() ?? Date.now();
    if (this.cached && this.cached.expiresAt - EARLY_MS > now) return this.cached.accessToken;
    const generation = this.generation;
    const t = await this.d.token();
    if (generation === this.generation) this.cached = { accessToken: t.accessToken, expiresAt: now + t.expiresIn * 1000 };
    return t.accessToken;
  }
}

/** Local midnight to the next local midnight, as RFC 3339 with the local offset. */
export function dayBounds(now: Date): { timeMin: string; timeMax: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { timeMin: rfc3339(start), timeMax: rfc3339(end) };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function rfc3339(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

type GoogleTime = { date?: string; dateTime?: string };
type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  location?: string;
  description?: string;
  start?: GoogleTime;
  end?: GoogleTime;
};

/** A Calendar API event as the app shows it; null for a cancelled one or one with no start. */
export function toCalendarEvent(item: unknown): CalendarEvent | null {
  if (!item || typeof item !== 'object') return null;
  const e = item as GoogleEvent;
  if (e.status === 'cancelled' || !e.id) return null;
  const start = toMs(e.start);
  if (start === null) return null;
  const allDay = !!e.start?.date && !e.start.dateTime;
  return {
    id: e.id,
    title: e.summary?.trim() || '(No title)',
    start,
    end: toMs(e.end) ?? start,
    allDay,
    link: e.htmlLink ?? '',
    ...(e.location?.trim() ? { location: e.location.trim() } : {}),
    ...(e.description?.trim() ? { description: e.description.trim().slice(0, MAX_DESCRIPTION) } : {}),
  };
}

function toMs(t: GoogleTime | undefined): number | null {
  if (t?.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : ms;
  }
  const m = t?.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null; // local midnight
}
