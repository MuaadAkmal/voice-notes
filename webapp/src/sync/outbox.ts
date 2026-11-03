import type { PushResponse } from "@wire/sync/protocol";
import { applyWebOp, type WebOp } from "@/lib/apply-op";

export type Mutation = { id: string; op: WebOp; baseVersion: number };
export type Unsaved = Record<string, { body: string; base: number }>;

const MAX_BATCH = 100; // PUSH_MAX_MUTATIONS
const MAX_BATCH_CHARS = 800_000; // the server refuses a request over 1 MB

type Entry = Mutation & { inFlight: boolean };

/**
 * Changes waiting for the server, in order. A row created here and not sent yet takes later edits
 * into its create (a delete cancels it), as the desktop's outbox does. While a page body waits, a newer
 * one replaces it, keeping the base it started from. Nothing already sent is ever changed.
 */
export class Outbox {
  private queue: Entry[] = [];

  get size(): number {
    return this.queue.length;
  }

  add(op: WebOp, baseVersion: number): void {
    const waiting = (pred: (m: Entry) => boolean) => this.queue.find((m) => !m.inFlight && m.op.id === op.id && pred(m));
    const create = waiting((m) => m.op.op.endsWith(".create") && m.op.op.split(".")[0] === op.op.split(".")[0]);
    if (create && create.op.op.endsWith(".create")) {
      if (op.op.endsWith(".delete")) return void (this.queue = this.queue.filter((m) => m !== create));
      const row = applyWebOp((create.op as Extract<WebOp, { row: unknown }>).row, op);
      if (row) return void (create.op = { ...create.op, row } as WebOp);
    }
    if (op.op === "page.setBody") {
      const body = waiting((m) => m.op.op === "page.setBody");
      if (body) return void (body.op = op);
    }
    this.queue.push({ id: crypto.randomUUID(), op, baseVersion, inFlight: false });
  }

  /** The next batch to push, under the server's size limit; it stays in flight until acked or released. */
  take(max = MAX_BATCH): Mutation[] {
    const batch: Entry[] = [];
    let chars = 0;
    for (const m of this.queue) {
      if (m.inFlight) continue;
      const size = JSON.stringify(m.op).length;
      if (batch.length >= max || (batch.length && chars + size > MAX_BATCH_CHARS)) break;
      batch.push(m);
      chars += size;
    }
    for (const m of batch) m.inFlight = true;
    return batch.map(({ id, op, baseVersion }) => ({ id, op, baseVersion }));
  }

  /** Removes the acked changes and returns them. */
  ack(acked: PushResponse["acked"]): Mutation[] {
    const ids = new Set(acked.map((a) => a.id));
    const done = this.queue.filter((m) => ids.has(m.id));
    this.queue = this.queue.filter((m) => !ids.has(m.id));
    return done.map(({ id, op, baseVersion }) => ({ id, op, baseVersion }));
  }

  /** A row's create was acked at `version`: changes queued behind it were based on that create. */
  rebase(id: string, version: number): void {
    for (const m of this.queue) if (m.op.id === id && m.baseVersion === 0) m.baseVersion = version;
  }

  /** A push failed: what was in flight goes out again next time. */
  release(): void {
    for (const m of this.queue) m.inFlight = false;
  }

  drop(ids: string[]): void {
    const gone = new Set(ids);
    this.queue = this.queue.filter((m) => !gone.has(m.id));
  }

  /** Every unacked change, sent or not, in order: laid back over pulled rows. */
  pendingOps(): WebOp[] {
    return this.queue.map((m) => m.op);
  }

  /** The base of the oldest unacked body of a page: an editor reopened before it is acked starts there. */
  baseOf(pageId: string): number | undefined {
    return this.queue.find((m) => m.op.op === "page.setBody" && m.op.id === pageId)?.baseVersion;
  }

  /** The latest unsaved body of each page, with the base its edit started from. */
  unsaved(): Unsaved {
    const out: Unsaved = {};
    for (const m of this.queue) {
      if (m.op.op !== "page.setBody") continue;
      out[m.op.id] = { body: m.op.body, base: out[m.op.id]?.base ?? m.baseVersion };
    }
    return out;
  }
}
