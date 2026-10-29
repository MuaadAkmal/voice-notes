import type { CalendarEvent, ConnectorsInfo, TodayResult } from '../../shared/channels';
import { NotSignedIn, Offline } from '../sync/http-server';
import { type ConnectorsClient, NotConnected, Revoked } from './client';
import type { GoogleCalendar } from './google-calendar';

// The Google Calendar connection, run in main. Connecting opens Google's consent in the browser; Google
// sends the browser to the `connectors` function, so this only waits for the function to say connected.

type Deps = {
  client: Pick<ConnectorsClient, 'start' | 'status' | 'disconnect'>;
  calendar: Pick<GoogleCalendar, 'todayEvents' | 'clear'>;
  signedIn(): boolean;
  openExternal(url: string): Promise<void>;
  focusApp(): void;
  onChange(info: ConnectorsInfo): void;
  pollMs?: number;
  timeoutMs?: number; // how long to wait for the browser
  now?(): number; // for the focus throttle
};

const FOCUS_REFRESH_MS = 60_000;
const NO_ANSWER = "Didn't hear back from Google. Try again.";

export class ConnectorsService {
  private info: ConnectorsInfo = { state: 'signed-out' };
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private lastFocus = -Infinity;

  constructor(private readonly d: Deps) {}

  current(): ConnectorsInfo {
    return this.info;
  }

  async refresh(): Promise<void> {
    if (!this.d.signedIn()) return this.set({ state: 'signed-out' });
    if (this.running) return; // the connect loop owns the state until it ends
    try {
      const { google } = await this.d.client.status();
      if (!this.running) this.set(google ? { state: 'connected', email: google.email } : { state: 'disconnected' });
    } catch (err) {
      if (err instanceof NotSignedIn) return this.set({ state: 'signed-out' });
      // Offline at start: say so rather than guess; a known state is kept.
      if (this.info.state === 'signed-out') this.set({ state: 'disconnected', error: message(err) });
    }
  }

  /** Signed in, out, or as someone else: whatever was in flight belonged to the old account. */
  onAccountChanged(): void {
    this.abort?.abort();
    this.d.calendar.clear();
    void this.refresh();
  }

  onFocus(): void {
    const now = this.d.now?.() ?? Date.now();
    if (now - this.lastFocus < FOCUS_REFRESH_MS) return;
    this.lastFocus = now;
    void this.refresh();
  }

  /** A second call while one runs joins it (one browser tab, one poll). */
  connect(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
      this.abort = null;
    });
    return this.running;
  }

  cancel(): void {
    if (!this.abort) return;
    this.abort.abort();
    this.set({ state: 'disconnected' });
  }

  async disconnect(): Promise<void> {
    await this.d.client.disconnect();
    this.d.calendar.clear();
    this.set({ state: 'disconnected' });
  }

  async today(now: Date): Promise<TodayResult> {
    if (!this.d.signedIn()) return { error: 'signed-out' };
    let events: CalendarEvent[];
    try {
      events = await this.d.calendar.todayEvents(now);
    } catch (err) {
      if (err instanceof Revoked) {
        this.set({ state: 'needs-reconnect' });
        return { error: 'needs-reconnect' };
      }
      if (err instanceof NotConnected) {
        this.set({ state: 'disconnected' });
        return { error: 'not-connected' };
      }
      if (err instanceof NotSignedIn) return { error: 'signed-out' };
      if (err instanceof Offline) return { error: 'offline' };
      return { error: 'failed' };
    }
    return { events };
  }

  private async run(): Promise<void> {
    if (!this.d.signedIn()) return this.set({ state: 'signed-out' });
    const abort = new AbortController();
    this.abort = abort;
    this.set({ state: 'connecting' });
    try {
      const { url } = await this.d.client.start();
      if (abort.signal.aborted) return;
      await this.d.openExternal(url);
      const deadline = Date.now() + (this.d.timeoutMs ?? 300_000);
      while (Date.now() < deadline) {
        await sleep(this.d.pollMs ?? 2000, abort.signal);
        if (abort.signal.aborted) return;
        const { google } = await this.d.client.status();
        if (abort.signal.aborted) return;
        if (google) {
          this.set({ state: 'connected', email: google.email });
          this.d.focusApp();
          return;
        }
      }
      this.set({ state: 'disconnected', error: NO_ANSWER });
    } catch (err) {
      if (!abort.signal.aborted) this.set({ state: 'disconnected', error: message(err) });
    } finally {
      abort.abort();
    }
  }

  private set(info: ConnectorsInfo): void {
    this.info = info;
    this.d.onChange(info);
  }
}

function message(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Something went wrong';
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });
