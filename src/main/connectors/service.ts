import type { AddResult, CalendarError, ConnectorsInfo, NewEvent, RangeResult, TodayResult } from '../../shared/channels';
import type { CallbackResult } from '../../shared/connectors/protocol';
import { NotSignedIn, Offline } from '../sync/http-server';
import { type ConnectorsClient, NotConnected, Revoked } from './client';
import type { GoogleCalendar } from './google-calendar';
import { listenForReturn } from './return-page';

// The Google Calendar connection, run in main. Connecting opens Google's consent in the browser; Google
// sends the browser to the `connectors` function, so this only asks the function how that consent ended.

type Deps = {
  client: Pick<ConnectorsClient, 'start' | 'status' | 'attempt' | 'disconnect'>;
  calendar: Pick<GoogleCalendar, 'todayEvents' | 'events' | 'create' | 'quickAdd' | 'clear'>;
  /** The signed-in account, or null. */
  userId(): string | null;
  openExternal(url: string): Promise<void>;
  focusApp(): void;
  onChange(info: ConnectorsInfo): void;
  pollMs?: number;
  timeoutMs?: number; // how long to wait for the browser
  now?(): number; // for the focus throttle
  /** The loopback page Google's consent lands on; tests inject one. */
  listen?: typeof listenForReturn;
};

const FOCUS_REFRESH_MS = 60_000;
const NO_ANSWER = "Didn't hear back from Google. Try again.";
const REFUSED: Partial<Record<CallbackResult, string>> = {
  denied: "Google Calendar wasn't connected.",
  'no-calendar': "Calendar access wasn't granted. Tick the calendar box and try again.",
  failed: 'Something went wrong at Google. Try again.',
  expired: NO_ANSWER,
};

export class ConnectorsService {
  private info: ConnectorsInfo = { state: 'signed-out' };
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private lastFocus = -Infinity;
  private user: string | null = null;
  // Bumped when the account changes: answers that were on their way for the old one are dropped.
  private generation = 0;

  constructor(private readonly d: Deps) {}

  current(): ConnectorsInfo {
    return this.info;
  }

  async refresh(): Promise<void> {
    this.user = this.d.userId();
    if (!this.user) return this.set({ state: 'signed-out' });
    if (this.connecting()) return; // the connect loop owns the state until it ends
    const generation = this.generation;
    try {
      const { google } = await this.d.client.status();
      if (generation !== this.generation || this.connecting()) return;
      if (google) this.set({ state: 'connected', email: google.email });
      // The server forgets a revoked connection; keep saying why until it is connected again.
      else if (this.info.state !== 'needs-reconnect') this.set({ state: 'disconnected' });
    } catch (err) {
      if (generation !== this.generation) return;
      if (err instanceof NotSignedIn) return this.set({ state: 'signed-out' });
      // Offline at start: say so rather than guess; a known state is kept.
      if (this.info.state === 'signed-out') this.set({ state: 'disconnected', error: message(err) });
    }
  }

  /** Called on every account event; only a different account (or signing in or out) resets anything. */
  onAccountChanged(): void {
    if (this.d.userId() === this.user) return;
    this.generation++;
    this.abort?.abort();
    this.d.calendar.clear();
    // Whatever this PC knew was about the old account.
    if (!this.d.userId()) this.set({ state: 'signed-out' });
    else if (this.info.state !== 'connected' && this.info.state !== 'disconnected') this.set({ state: 'disconnected' });
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

  today(now: Date): Promise<TodayResult> {
    return this.guard(async () => ({ events: await this.d.calendar.todayEvents(now) }));
  }

  range(from: Date, to: Date): Promise<RangeResult> {
    return this.guard(async () => ({ events: await this.d.calendar.events(from, to) }));
  }

  create(e: NewEvent): Promise<AddResult> {
    return this.guard(async () => ({ event: await this.d.calendar.create(e) }));
  }

  quickAdd(text: string): Promise<AddResult> {
    return this.guard(async () => ({ event: await this.d.calendar.quickAdd(text) }));
  }

  /** A Calendar call, its failure as the word the window shows; a revoked connection also moves the state. */
  private async guard<T>(fn: () => Promise<T>): Promise<T | { error: CalendarError }> {
    if (!this.d.userId()) return { error: 'signed-out' };
    const generation = this.generation;
    try {
      return await fn();
    } catch (err) {
      if (generation !== this.generation) return { error: 'failed' };
      if (err instanceof Revoked || (err instanceof NotConnected && this.info.state === 'needs-reconnect')) {
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
  }

  private connecting(): boolean {
    return !!this.abort && !this.abort.signal.aborted;
  }

  private async run(): Promise<void> {
    this.user = this.d.userId();
    if (!this.user) return this.set({ state: 'signed-out' });
    const abort = new AbortController();
    this.abort = abort;
    this.set({ state: 'connecting' });
    try {
      const timeoutMs = this.d.timeoutMs ?? 300_000;
      // Without a listener (port taken, firewall…) the function answers plain text and polling still works.
      const back = await (this.d.listen ?? listenForReturn)({ timeoutMs, signal: abort.signal }).catch(() => null);
      const { url } = await this.d.client.start(back?.port);
      const state = new URL(url).searchParams.get('state') ?? '';
      if (abort.signal.aborted) return;
      await this.d.openExternal(url);
      const deadline = Date.now() + timeoutMs;
      let landed = back ? back.arrived.then(() => true) : null;
      while (Date.now() < deadline) {
        // The browser landing on the page means Google is done: ask at once instead of at the next poll.
        const waits = [sleep(this.d.pollMs ?? 2000, abort.signal).then(() => false)];
        const early = await Promise.race(landed ? [...waits, landed] : waits);
        if (early) landed = null; // once is enough; after that, poll as usual
        if (abort.signal.aborted) return;
        const { result } = await this.d.client.attempt(state);
        if (abort.signal.aborted) return;
        if (result === 'connected') {
          const { google } = await this.d.client.status();
          if (abort.signal.aborted) return;
          this.set(google ? { state: 'connected', email: google.email } : { state: 'disconnected', error: NO_ANSWER });
          if (google) this.d.focusApp();
          return;
        }
        if (result) return this.set({ state: 'disconnected', error: REFUSED[result] ?? NO_ANSWER });
      }
      this.set({ state: 'disconnected', error: NO_ANSWER });
    } catch (err) {
      if (!abort.signal.aborted) this.set({ state: 'disconnected', error: message(err) });
    } finally {
      abort.abort();
    }
  }

  /** Publishes only a change: the Home card reloads on every push, and reloading can set the same state again. */
  private set(info: ConnectorsInfo): void {
    if (JSON.stringify(info) === JSON.stringify(this.info)) return;
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
