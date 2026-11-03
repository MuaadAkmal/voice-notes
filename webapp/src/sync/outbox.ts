import type { PushResponse } from "@wire/sync/protocol";
import type { WebOp } from "@/lib/apply-op";

export type Mutation = { id: string; op: WebOp; baseVersion: number };

const MAX_BATCH = 100; // PUSH_MAX_MUTATIONS

/**
 * Changes waiting for the server, in order. While a page body waits, a newer one replaces it (one
 * pending body per page, keeping the base it started from); a body already sent is never touched.
 */
export class Outbox {
  private queue: (Mutation & { inFlight: boolean })[] = [];

  get size(): number {
    return this.queue.length;
  }

  add(op: WebOp, baseVersion: number): void {
    if (op.op === "page.setBody") {
      const waiting = this.queue.find((m) => !m.inFlight && m.op.op === "page.setBody" && m.op.id === op.id);
      if (waiting) return void (waiting.op = op);
    }
    this.queue.push({ id: crypto.randomUUID(), op, baseVersion, inFlight: false });
  }

  /** The next batch to push; it stays in flight until acked or released. */
  take(max = MAX_BATCH): Mutation[] {
    const batch = this.queue.filter((m) => !m.inFlight).slice(0, max);
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

  /** The latest unsaved body of each page. */
  bodies(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of this.queue) if (m.op.op === "page.setBody") out[m.op.id] = m.op.body;
    return out;
  }
}
