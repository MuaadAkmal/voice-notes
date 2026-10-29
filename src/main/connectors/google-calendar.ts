import type { CalendarEvent } from '../../shared/channels';
import type { TokenResponse } from '../../shared/connectors/protocol';
import { AuthExpired, Offline } from '../sync/http-server';

// Today's events from the user's primary Google Calendar, called from main with a short-lived access
// token from the `connectors` function (kept in memory only).

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const EARLY_MS = 60_000; // a token this close to expiring is fetched again

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

  async todayEvents(now: Date): Promise<CalendarEvent[]> {
    const { timeMin, timeMax } = dayBounds(now);
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
    const url = `${this.d.baseUrl ?? CALENDAR_API}/calendars/primary/events?${params}`;
    let res = await this.get(url);
    if (res.status === 401) {
      this.cached = null; // revoked or rotated early: one more try with a fresh token
      res = await this.get(url);
      if (res.status === 401) throw new AuthExpired();
    }
    if (!res.ok) throw new Error(`Google Calendar answered ${res.status}`);
    const body = (await res.json()) as { items?: unknown[] };
    return (body.items ?? []).map(toCalendarEvent).filter((e): e is CalendarEvent => e !== null);
  }

  clear(): void {
    this.cached = null;
    this.generation++;
  }

  private async get(url: string): Promise<Response> {
    const token = await this.accessToken();
    try {
      return await this.d.fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
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

function rfc3339(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

type GoogleTime = { date?: string; dateTime?: string };
type GoogleEvent = { id?: string; status?: string; summary?: string; htmlLink?: string; start?: GoogleTime; end?: GoogleTime };

/** A Calendar API event as the card shows it; null for a cancelled one or one with no start. */
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
