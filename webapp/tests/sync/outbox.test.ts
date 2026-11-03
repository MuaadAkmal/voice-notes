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

it("caps a batch well under the server's 1 MB, but always sends at least one", () => {
  const o = new Outbox();
  const big = "x".repeat(350_000);
  for (const id of ["a", "b", "c"]) o.add({ op: "page.setBody", id, body: big }, 1);
  expect(o.take()).toHaveLength(2);
  const huge = new Outbox();
  huge.add({ op: "page.setBody", id: "a", body: "y".repeat(2_000_000) }, 1);
  expect(huge.take()).toHaveLength(1);
});

it("knows the base of a page's waiting body, and the unsaved bodies with their bases", () => {
  const o = new Outbox();
  o.add({ op: "page.setBody", id: "p", body: "a" }, 5);
  expect(o.baseOf("p")).toBe(5);
  expect(o.baseOf("q")).toBeUndefined();
  expect(o.unsaved()).toEqual({ p: { body: "a", base: 5 } });
});
