import { expect, it } from "vitest";
import { Outbox } from "@/sync/outbox";

const body = (b: string) => ({ op: "page.setBody" as const, id: "p", body: b });

it("merges queued bodies of a page, keeping the first id and base version", () => {
  const o = new Outbox();
  o.add(body("a"), 3);
  o.add(body("ab"), 4);
  const [m, ...rest] = o.take();
  expect(rest).toEqual([]);
  expect(m.op).toEqual(body("ab"));
  expect(m.baseVersion).toBe(3);
});

it("never merges into a body already in flight", () => {
  const o = new Outbox();
  o.add(body("a"), 3);
  const first = o.take();
  o.add(body("ab"), 3);
  expect(first).toHaveLength(1);
  expect(first[0].op).toEqual(body("a"));
  const second = o.take();
  expect(second).toHaveLength(1);
  expect(second[0].op).toEqual(body("ab"));
  expect(o.pendingOps()).toEqual([body("a"), body("ab")]);
  expect(o.unsaved()).toEqual({ p: { body: "ab", base: 3 } });
});

it("acks by id and releases in-flight ops in order", () => {
  const o = new Outbox();
  o.add({ op: "note.delete", id: "n1" }, 1);
  o.add({ op: "note.delete", id: "n2" }, 1);
  const batch = o.take();
  o.release();
  expect(o.take().map((m) => m.id)).toEqual(batch.map((m) => m.id));
  const acked = o.ack([{ id: batch[0].id, version: 7 }]);
  expect(acked.map((m) => m.op.id)).toEqual(["n1"]);
  expect(o.size).toBe(1);
  o.drop([batch[1].id]);
  expect(o.size).toBe(0);
});

it("takes at most 100", () => {
  const o = new Outbox();
  for (let i = 0; i < 150; i++) o.add({ op: "note.delete", id: `n${i}` }, 1);
  expect(o.take()).toHaveLength(100);
  expect(o.take()).toHaveLength(50);
});

const draft = { id: "p", title: "Untitled", body: "", folderId: null, starred: false, createdAt: 1, updatedAt: 1 };

it("folds edits into a page create still waiting, and a delete cancels it", () => {
  const o = new Outbox();
  o.add({ op: "page.create", id: "p", row: draft }, 0);
  o.add({ op: "page.setBody", id: "p", body: "typed", at: 5 }, 0);
  o.add({ op: "page.update", id: "p", fields: { title: "Named" } }, 0);
  const batch = o.take();
  expect(batch).toHaveLength(1);
  expect(batch[0].op).toEqual({ op: "page.create", id: "p", row: { ...draft, body: "typed", title: "Named", updatedAt: 5 } });
  o.ack([{ id: batch[0].id, version: 1 }]);
  o.add({ op: "page.create", id: "q", row: { ...draft, id: "q" } }, 0);
  o.add({ op: "page.delete", id: "q" }, 0);
  expect(o.size).toBe(0);
});

it("gives ops queued behind an in-flight create the create's version once acked", () => {
  const o = new Outbox();
  o.add({ op: "page.create", id: "p", row: draft }, 0);
  const [create] = o.take();
  o.add({ op: "page.setBody", id: "p", body: "x" }, 0);
  o.ack([{ id: create.id, version: 40 }]);
  o.rebase("p", 40);
  expect(o.take()[0].baseVersion).toBe(40);
});

it("caps a batch under the server's 1 MB; a change no request could carry is kept, not sent", () => {
  const o = new Outbox();
  const big = "x".repeat(350_000);
  for (const id of ["a", "b", "c"]) o.add({ op: "page.setBody", id, body: big }, 1);
  expect(o.take()).toHaveLength(2);
  const huge = new Outbox();
  huge.add({ op: "page.setBody", id: "a", body: "y".repeat(2_000_000) }, 1);
  expect(huge.take()).toHaveLength(0);
  expect(huge.size).toBe(1);
});

it("knows the base of a page's waiting body, and the unsaved bodies with their bases", () => {
  const o = new Outbox();
  o.add({ op: "page.setBody", id: "p", body: "a" }, 5);
  expect(o.baseOf("p")).toBe(5);
  expect(o.baseOf("q")).toBeUndefined();
  expect(o.unsaved()).toEqual({ p: { body: "a", base: 5 } });
});

it("a body sent once is never replaced, even after a failed push released it", () => {
  const o = new Outbox();
  o.add(body("a"), 3);
  const [first] = o.take();
  o.release(); // the response was lost: the server may have applied it
  o.add(body("ab"), 3);
  const batch = o.take();
  expect(batch.map((m) => m.op)).toEqual([body("a"), body("ab")]);
  expect(batch[0].id).toBe(first.id);
});

it("a body never merges past a quick-add entry queued after it", () => {
  const o = new Outbox();
  const append = { op: "page.append" as const, id: "p", text: "milk", day: "2026-11-05" };
  o.add(body("list"), 3);
  o.add(append, 3);
  o.add(body("list - milk, edited"), 3);
  expect(o.take().map((m) => m.op.op)).toEqual(["page.setBody", "page.append", "page.setBody"]);
});

it("batches by UTF-8 bytes, not characters", () => {
  const o = new Outbox();
  const wide = "中".repeat(200_000); // 600 kB in UTF-8, 200k characters
  for (const id of ["a", "b", "c"]) o.add({ op: "page.setBody", id, body: wide }, 1);
  const sizes = [o.take(), o.take(), o.take()].map((b) => b.length);
  expect(sizes).toEqual([1, 1, 1]);
});

it("a change too big for any request holds back only its own page; a newer body replaces it", () => {
  const o = new Outbox();
  o.add({ op: "page.setBody", id: "big", body: "x".repeat(1_100_000) }, 1);
  o.add({ op: "page.update", id: "big", fields: { title: "t" } }, 1);
  o.add({ op: "note.delete", id: "n" }, 1);
  expect(o.take().map((m) => m.op.id)).toEqual(["n"]);
  expect(o.oversized()).toEqual(["big"]);
  o.add({ op: "page.setBody", id: "big", body: "short" }, 1);
  expect(o.take().map((m) => m.op.op)).toEqual(["page.update", "page.setBody"]);
  expect(o.oversized()).toEqual([]);
});

it("unsaved text includes new pages the server hasn't got, with their row", () => {
  const o = new Outbox();
  o.add({ op: "page.create", id: "p", row: draft }, 0);
  o.add({ op: "page.setBody", id: "p", body: "typed", at: 5 }, 0);
  o.add({ op: "page.create", id: "empty", row: { ...draft, id: "empty" } }, 0);
  expect(o.unsaved()).toEqual({ p: { body: "typed", base: 0, row: { ...draft, body: "typed", updatedAt: 5 } } });
});

it("drop hands back the text of what it removed", () => {
  const o = new Outbox();
  o.add(body("lost"), 4);
  const [m] = o.take();
  expect(o.drop([m.id])).toEqual({ p: { body: "lost", base: 4 } });
  expect(o.size).toBe(0);
});
