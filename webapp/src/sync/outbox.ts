import type { PushResponse } from "@wire/sync/protocol";
import type { PageRow } from "@wire/sync-ops";
import { applyWebOp, type WebOp } from "@/lib/apply-op";

export type Mutation = { id: string; op: WebOp; baseVersion: number };
/** Page text not saved yet, with the base its edit started from; `row`: a new page the server may not have. */
export type Unsaved = Record<string, { body: string; base: number; row?: PageRow }>;

const MAX_BATCH = 100; // PUSH_MAX_MUTATIONS
// The server refuses a request over 1 MiB (UTF-8 bytes); the rest is room for the ids around the mutations.
export const MAX_BATCH_BYTES = 1024 * 1024 - 4096;

// sent: went out at least once. The server may have applied it, so its id must keep meaning this
// payload: nothing merges into it again, even after a failed push released it.
type Entry = Mutation & { inFlight: boolean; sent: boolean };

const encoder = new TextEncoder();
const bytesOf = ({ id, op, baseVersion }: Mutation) => encoder.encode(JSON.stringify({ id, op, baseVersion })).length;

/**
 * Changes waiting for the server, in order. A row created here and not sent yet takes later edits
 * into its create (a delete cancels it), as the desktop's outbox does. While a page body waits as the
 * page's latest change, a newer one replaces it, keeping the base it started from. Nothing ever sent is
 * changed.
 */
export class Outbox {
  private queue: Entry[] = [];
  private tooLarge = new Set<string>();

  get size(): number {
    return this.queue.length;
  }

  add(op: WebOp, baseVersion: number): void {
    // Only the row's latest change may absorb this one, so the order of its changes never shifts.
    const last = this.latest(op.id);
    if (last && !last.sent && last.op.op.endsWith(".create") && last.op.op.split(".")[0] === op.op.split(".")[0]) {
      if (op.op.endsWith(".delete")) return void (this.queue = this.queue.filter((m) => m !== last));
      const row = applyWebOp((last.op as Extract<WebOp, { row: unknown }>).row, op);
      if (row) return void (last.op = { ...last.op, row } as WebOp);
    }
    if (op.op === "page.setBody" && last && !last.sent && last.op.op === "page.setBody") return void (last.op = op);
    this.queue.push({ id: crypto.randomUUID(), op, baseVersion, inFlight: false, sent: false });
  }

  private latest(id: string): Entry | undefined {
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].op.id === id) return this.queue[i];
    return undefined;
  }

  /**
   * The next batch to push, under the server's size limit; it stays in flight until acked or released.
   * A change too big for any request stays here and holds back its row's later changes (`oversized`);
   * a page body like that is dropped once a newer body of the page waits behind it.
   */
  take(max = MAX_BATCH): Mutation[] {
    const batch: Entry[] = [];
    const held = new Set<string>();
    let bytes = 0;
    this.tooLarge.clear();
    for (const [i, m] of [...this.queue].entries()) {
      if (m.inFlight || held.has(m.op.id)) continue;
      const size = bytesOf(m);
      if (size > MAX_BATCH_BYTES) {
        // No request could carry it, so the server never applied it: a newer body can take its place.
        const newer = m.op.op === "page.setBody" && this.queue.slice(i + 1).some((n) => n.op.id === m.op.id && n.op.op === "page.setBody");
        if (newer) this.queue = this.queue.filter((e) => e !== m);
        else {
          held.add(m.op.id);
          this.tooLarge.add(m.op.id);
        }
        continue;
      }
      if (batch.length >= max || bytes + size > MAX_BATCH_BYTES) break;
      batch.push(m);
      bytes += size;
    }
    for (const m of batch) {
      m.inFlight = true;
      m.sent = true;
    }
    return batch.map(({ id, op, baseVersion }) => ({ id, op, baseVersion }));
  }

  /** Rows whose waiting change is too big to ever send, as of the last take. */
  oversized(): string[] {
    return [...this.tooLarge];
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

  /** Removes these changes and returns the page text they carried, to offer back later. */
  drop(ids: string[]): Unsaved {
    const gone = new Set(ids);
    const lost = textOf(this.queue.filter((m) => gone.has(m.id)));
    this.queue = this.queue.filter((m) => !gone.has(m.id));
    return lost;
  }

  /** Every unacked change, sent or not, in order: laid back over pulled rows. */
  pendingOps(): WebOp[] {
    return this.queue.map((m) => m.op);
  }

  /** The base of the oldest unacked body of a page: an editor reopened before it is acked starts there. */
  baseOf(pageId: string): number | undefined {
    return this.queue.find((m) => m.op.op === "page.setBody" && m.op.id === pageId)?.baseVersion;
  }

  /** The latest unsaved text of each page, with the base its edit started from; new pages keep their row. */
  unsaved(): Unsaved {
    return textOf(this.queue);
  }
}

function textOf(entries: Entry[]): Unsaved {
  const out: Unsaved = {};
  for (const m of entries) {
    if (m.op.op === "page.setBody") {
      const prev = out[m.op.id];
      out[m.op.id] = prev?.row ? { ...prev, body: m.op.body } : { body: m.op.body, base: prev?.base ?? m.baseVersion };
    } else if (m.op.op === "page.create" && m.op.row.body) {
      out[m.op.id] = { body: m.op.row.body, base: 0, row: m.op.row };
    }
  }
  return out;
}
