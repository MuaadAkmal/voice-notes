import type { WebOp } from "@/lib/apply-op";
import { AuthExpired, NotSignedIn, Offline, Rejected, type SyncClient } from "./client";
import type { Outbox } from "./outbox";
import type { Entity, WebStore } from "./store";

export type SyncStatus = "saved" | "saving" | "offline" | "error";

type Deps = {
  client: Pick<SyncClient, "pull" | "push">;
  store: WebStore;
  outbox: Outbox;
  clientId: string;
  deviceName: string;
  /** Refreshes the session; false when the user has to sign in again. */
  refresh: () => Promise<boolean>;
  /** The session is gone: the unsaved page bodies, for restoring after the next sign-in. */
  onSignedOut: (unsaved: Record<string, string>) => void;
  onRejected?: (message: string) => void;
  now?: () => number;
};

const EDIT_DELAY_MS = 1000;
const TICK_MS = 5 * 60_000;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

class SignedOut extends Error {}

const entityOf = (op: WebOp) => op.op.split(".")[0] as Entity;

/** Push then pull, one cycle at a time: after edits, on a timer, on focus and on a ping from another device. */
export class SyncEngine {
  status: SyncStatus = "saved";
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private retryAt = 0;
  private failures = 0;
  private stopped = false;
  private listeners = new Set<(s: SyncStatus) => void>();
  private readonly now: () => number;
  private readonly onFocus = () => this.poke();

  constructor(private readonly d: Deps) {
    this.now = d.now ?? Date.now;
  }

  get clientId(): string {
    return this.d.clientId;
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  start(): void {
    this.stopped = false;
    if (typeof window !== "undefined") window.addEventListener("focus", this.onFocus);
    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof window !== "undefined") window.removeEventListener("focus", this.onFocus);
  }

  /** Applies a change here at once and sends it shortly. */
  edit(op: WebOp): void {
    const base = this.d.store.version(entityOf(op), op.id);
    this.d.store.applyLocal(op);
    this.d.outbox.add(op, base);
    this.setStatus(this.status === "saved" ? "saving" : this.status);
    this.schedule(EDIT_DELAY_MS);
  }

  /** Another device pushed; our own pushes come back as pings too and are ignored. */
  ping(from: string): void {
    if (from !== this.d.clientId) this.poke();
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && !this.stopped);
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Sync soon, unless waiting out a failure. */
  private poke(): void {
    if (this.now() >= this.retryAt) void this.syncNow();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    const at = Math.max(this.now() + ms, this.retryAt);
    if (this.timer && this.timerAt <= at) return; // a sooner sync is already set
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerAt = Infinity;
      void this.syncNow();
    }, at - this.now());
  }

  private async cycle(): Promise<void> {
    const { client, store, outbox } = this.d;
    if (this.stopped) return;
    if (outbox.size) this.setStatus("saving");
    try {
      for (let batch = outbox.take(); batch.length; batch = outbox.take()) {
        try {
          const res = await this.authed(() => client.push({ clientId: this.d.clientId, deviceName: this.d.deviceName, mutations: batch }));
          const versions = new Map(res.acked.map((a) => [a.id, a.version]));
          for (const m of outbox.ack(res.acked)) store.setVersion(entityOf(m.op), m.op.id, versions.get(m.id)!);
        } catch (err) {
          if (!(err instanceof Rejected)) throw err;
          // This batch can never succeed; the pull below restores the server's rows.
          outbox.drop(batch.map((m) => m.id));
          this.d.onRejected?.(err.message);
        }
      }
      for (let more = true; more; ) {
        const res = await this.authed(() => client.pull({ clientId: this.d.clientId, cursor: store.snapshot().cursor }));
        store.applyPull(res, outbox.pendingOps());
        more = res.hasMore;
      }
      store.markLoaded();
      this.failures = 0;
      this.retryAt = 0;
      this.setStatus(outbox.size ? "saving" : "saved");
      this.schedule(outbox.size ? EDIT_DELAY_MS : TICK_MS);
    } catch (err) {
      outbox.release();
      if (err instanceof SignedOut || err instanceof NotSignedIn) {
        this.stop();
        this.d.onSignedOut(outbox.bodies());
        return;
      }
      this.failures++;
      const wait = Math.min(BACKOFF_MIN_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
      this.retryAt = this.now() + wait;
      this.setStatus(err instanceof Offline ? "offline" : "error");
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.schedule(wait);
    }
  }

  /** Runs a call, refreshing the session once on 401. */
  private async authed<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof AuthExpired)) throw err;
      if (!(await this.d.refresh().catch(() => false))) throw new SignedOut();
      try {
        return await call();
      } catch (again) {
        throw again instanceof AuthExpired ? new SignedOut() : again;
      }
    }
  }

  private setStatus(s: SyncStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }
}
