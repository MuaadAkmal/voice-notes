import type { WebOp } from "@/lib/apply-op";
import { AuthExpired, NotSignedIn, Offline, Rejected, type SyncClient } from "./client";
import type { Outbox, Unsaved } from "./outbox";
import type { Entity, WebStore } from "./store";

export type SyncStatus = "saved" | "saving" | "offline" | "error";

type Deps = {
  client: Pick<SyncClient, "pull" | "push">;
  store: WebStore;
  outbox: Outbox;
  clientId: string;
  deviceName: string;
  /** Refreshes the session: 'signed-out' when the user has to sign in again, 'offline' when it couldn't ask. */
  refresh: () => Promise<"ok" | "signed-out" | "offline">;
  /** The session is gone: the unsaved page bodies, for restoring after the next sign-in. */
  onSignedOut: (unsaved: Unsaved) => void;
  /** The server refused a change for good; `lost`: the page text it carried, to keep for the user. */
  onRejected?: (message: string, lost: Unsaved) => void;
  /** Pages whose text is too big to ever send; it stays queued here until made shorter. */
  onTooLarge?: (pageIds: string[]) => void;
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
  private drafts = new Map<string, () => { body: string; base: number } | null>();
  private abort = new AbortController();
  private reportedTooLarge = "";
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
    if (this.abort.signal.aborted) this.abort = new AbortController();
    if (typeof window !== "undefined") window.addEventListener("focus", this.onFocus);
    void this.syncNow();
  }

  /** Stops for good until start(): a request on its way is cancelled and no further batch goes out. */
  stop(): void {
    this.stopped = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (typeof window !== "undefined") window.removeEventListener("focus", this.onFocus);
  }

  /**
   * Applies a change here at once and sends it shortly. `baseVersion`: the version the change was made
   * on, when that isn't the row's current one (an open editor's text predates later pulls).
   */
  edit(op: WebOp, opts: { baseVersion?: number } = {}): void {
    const base = opts.baseVersion ?? this.d.store.version(entityOf(op), op.id);
    this.d.store.applyLocal(op);
    this.d.outbox.add(op, base);
    this.setStatus(this.status === "saved" ? "saving" : this.status);
    this.schedule(EDIT_DELAY_MS);
  }

  /** Where an editor opening on a page starts: an unacked body's base, else the page's version. */
  baseFor(pageId: string): number {
    return this.d.outbox.baseOf(pageId) ?? this.d.store.version("page", pageId);
  }

  /** Text an editor hasn't handed over yet, so it survives a lost session. */
  registerDraft(pageId: string, read: () => { body: string; base: number } | null): () => void {
    this.drafts.set(pageId, read);
    return () => {
      if (this.drafts.get(pageId) === read) this.drafts.delete(pageId);
    };
  }

  /** Everything not saved yet: queued bodies, then editors' newer text. */
  unsaved(): Unsaved {
    const out = this.d.outbox.unsaved();
    for (const [id, read] of this.drafts) {
      const draft = read();
      if (draft) out[id] = { body: draft.body, base: out[id]?.base ?? draft.base };
    }
    return out;
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
      const { signal } = this.abort;
      // After a refused batch, one change at a time, so only the change at fault is dropped.
      let single = false;
      for (let batch = outbox.take(); batch.length; batch = outbox.take(single ? 1 : undefined)) {
        if (this.stopped) return void outbox.release();
        try {
          const res = await this.authed(() => client.push({ clientId: this.d.clientId, deviceName: this.d.deviceName, mutations: batch }, signal));
          if (this.stopped) return void outbox.release();
          const versions = new Map(res.acked.map((a) => [a.id, a.version]));
          for (const m of outbox.ack(res.acked)) {
            const version = versions.get(m.id)!;
            store.setVersion(entityOf(m.op), m.op.id, version);
            if (m.op.op.endsWith(".create")) outbox.rebase(m.op.id, version);
          }
        } catch (err) {
          if (!(err instanceof Rejected)) throw err;
          if (batch.length > 1) {
            outbox.release();
            single = true;
            continue;
          }
          // This change can never succeed; the pull below restores the server's row, and its text is kept.
          this.d.onRejected?.(err.message, outbox.drop(batch.map((m) => m.id)));
        }
      }
      this.reportTooLarge(outbox.oversized());
      for (let more = true; more; ) {
        if (this.stopped) return;
        const res = await this.authed(() => client.pull({ clientId: this.d.clientId, cursor: store.snapshot().cursor }, signal));
        if (this.stopped) return;
        store.applyPull(res, outbox.pendingOps());
        more = res.hasMore;
      }
      store.markLoaded();
      this.failures = 0;
      this.retryAt = 0;
      // A page too big to send waits for a shorter edit, which schedules its own sync.
      const tooLarge = outbox.oversized().length > 0;
      this.setStatus(tooLarge ? "error" : outbox.size ? "saving" : "saved");
      this.schedule(outbox.size && !tooLarge ? EDIT_DELAY_MS : TICK_MS);
    } catch (err) {
      outbox.release();
      if (this.stopped) return;
      if (err instanceof SignedOut || err instanceof NotSignedIn) {
        this.stop();
        this.d.onSignedOut(this.unsaved());
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

  /** Tells about pages too big to send, once per change in that list. */
  private reportTooLarge(ids: string[]): void {
    const key = ids.join(",");
    if (key === this.reportedTooLarge) return;
    this.reportedTooLarge = key;
    if (ids.length) this.d.onTooLarge?.(ids);
  }

  /** Runs a call, refreshing the session once on 401. */
  private async authed<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof AuthExpired)) throw err;
      const refreshed = await this.d.refresh().catch(() => "offline" as const);
      if (refreshed === "offline") throw new Offline();
      if (refreshed === "signed-out") throw new SignedOut();
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
