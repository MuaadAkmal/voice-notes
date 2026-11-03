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
  expect(o.bodies()).toEqual({ p: "ab" });
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
