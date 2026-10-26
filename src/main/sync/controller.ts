import type { Settings, SyncStatus, SyncView } from '../../shared/channels';
import type { PullChanges } from './apply';
import { AccountChanged } from './engine';
import { AuthExpired, NotSignedIn, Offline, Rejected, ServerError } from './http-server';

// When this PC syncs, and what the Account page says about it. The engine does the syncing; this
// decides when (start, 3 s after edits, every 5 min, on wake, Sync now), retries with backoff, and
// keeps one account's data out of another's.

export type { SyncView } from '../../shared/channels';

type StateLike = {
  accountId(): string | null;
  setAccountId(id: string | null): void;
  network(): boolean;
  setNetwork(on: boolean): void;
  enabled(): boolean;
  promptDismissedFor(): string | null;
  setPromptDismissedFor(id: string | null): void;
};

type Deps = {
  engine: { sync(): Promise<PullChanges>; enable(s: Settings): void; startFresh(s: Settings): void };
  state: StateLike;
  settings(): Settings;
  /** The signed-in user's id, or null. */
  currentUser(): string | null;
  /** Ask supabase-js for a fresh access token (after a 401). */
  refreshSession(): Promise<void>;
  onView(view: SyncView): void;
  onChanged(changes: PullChanges): void;
};

const DEBOUNCE_MS = 3000;
const TICK_MS = 5 * 60_000;
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 600_000];

export class SyncController {
  private status: SyncStatus = { mode: 'off' };
  private lastSyncedAt: number | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private running: Promise<void> | null = null;
  /** A sync was asked for while one ran (an edit, Turn on, Sync now): run again right after. */
  private rerun = false;

  constructor(private readonly d: Deps) {}

  start(): void {
    this.tick = setInterval(() => this.triggerUnlessWaiting(), TICK_MS);
    this.refresh();
    this.trigger();
  }

  stop(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    this.clearTimers();
  }

  view(): SyncView {
    return { status: this.status, needsPrompt: this.needsPrompt() };
  }

  /** "Turn on" / the switch. A different account than before starts fresh; the same one resumes. */
  turnOn(userId: string): void {
    const { state, engine, settings } = this.d;
    if (state.accountId() !== userId) {
      engine.startFresh(settings());
      state.setAccountId(userId);
    } else if (!state.enabled()) {
      engine.enable(settings());
    }
    state.setNetwork(true);
    this.failures = 0;
    this.refresh();
    this.trigger();
  }

  /** The switch off: no more syncing, but changes keep queueing for when it's back on. */
  turnOff(): void {
    this.d.state.setNetwork(false);
    this.clearTimers();
    this.refresh();
  }

  syncNow(): void {
    this.failures = 0;
    this.clearTimers();
    this.trigger();
  }

  dismissPrompt(): void {
    const user = this.d.currentUser();
    if (user) this.d.state.setPromptDismissedFor(user);
    this.emit();
  }

  /** Something was recorded in the outbox: sync once the edits settle. */
  onLocalChange(): void {
    if (!this.canSync()) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.triggerUnlessWaiting();
    }, DEBOUNCE_MS);
  }

  /** The timer and new edits respect a pending retry (no storm while offline); wake and Sync now don't. */
  private triggerUnlessWaiting(): void {
    if (!this.retry) this.trigger();
  }

  onResume(): void {
    this.trigger();
  }

  /** Signed in, out, or as someone else. */
  onAccountChanged(): void {
    if (!this.canSync()) this.clearTimers();
    this.refresh();
    this.trigger();
  }

  private canSync(): boolean {
    const user = this.d.currentUser();
    return !!user && this.d.state.network() && this.d.state.accountId() === user;
  }

  private needsPrompt(): boolean {
    const user = this.d.currentUser();
    return !!user && this.d.state.accountId() !== user && this.d.state.promptDismissedFor() !== user;
  }

  /** The mode that follows from sign-in and the switch (between syncs). */
  private refresh(): void {
    const user = this.d.currentUser();
    const { state } = this.d;
    if (!user) this.status = state.network() && state.accountId() ? { mode: 'paused', reason: 'signed-out' } : { mode: 'off' };
    else if (state.accountId() !== user || !state.network()) this.status = { mode: 'off' };
    else if (this.status.mode !== 'offline' && this.status.mode !== 'error' && this.status.mode !== 'syncing')
      this.status = { mode: 'idle', lastSyncedAt: this.lastSyncedAt };
    this.emit();
  }

  private trigger(): void {
    if (!this.canSync()) return;
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.rerun) {
        this.rerun = false;
        this.trigger();
      }
    });
  }

  private async run(retriedAuth = false): Promise<void> {
    this.set({ mode: 'syncing' });
    try {
      const changes = await this.d.engine.sync();
      this.failures = 0;
      this.lastSyncedAt = Date.now();
      if (this.canSync()) this.set({ mode: 'idle', lastSyncedAt: this.lastSyncedAt });
      else this.refresh();
      if (changes.notes || changes.pages || changes.folders || changes.prefs) this.d.onChanged(changes);
    } catch (err) {
      if (err instanceof AccountChanged) {
        this.status = { mode: 'idle', lastSyncedAt: this.lastSyncedAt };
        this.refresh(); // the next run (already asked for by Turn on) syncs the new account
        return;
      }
      if (err instanceof AuthExpired && !retriedAuth) {
        await this.d.refreshSession().catch(() => undefined);
        return this.run(true);
      }
      if (err instanceof AuthExpired) this.set({ mode: 'error', message: err.message });
      else if (err instanceof NotSignedIn) this.set({ mode: 'paused', reason: 'signed-out' });
      else if (err instanceof Offline || err instanceof ServerError) this.scheduleRetry();
      else if (err instanceof Rejected) this.set({ mode: 'error', message: err.message });
      else this.set({ mode: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  private scheduleRetry(): void {
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
    this.failures += 1;
    this.set({ mode: 'offline', retryAt: Date.now() + delay });
    this.retry = setTimeout(() => {
      this.retry = null;
      this.trigger();
    }, delay);
  }

  private clearTimers(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retry) clearTimeout(this.retry);
    this.debounce = this.retry = null;
  }

  private set(status: SyncStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
    this.d.onView(this.view());
  }
}
