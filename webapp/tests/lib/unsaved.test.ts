import { beforeEach, expect, it } from "vitest";
import { saveUnsaved, takeUnsaved } from "@/lib/unsaved";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  globalThis.sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  } as Storage;
});

it("hands the saved bodies back once", () => {
  saveUnsaved("u1", { p: { body: "draft", base: 3 } });
  expect(takeUnsaved("u1")).toEqual({ p: { body: "draft", base: 3 } });
  expect(takeUnsaved("u1")).toBeNull();
});

it("nothing saved, an empty map, or garbage is null", () => {
  saveUnsaved("u1", {});
  expect(takeUnsaved("u1")).toBeNull();
  mem.set("vn.unsaved.u1", "{not json");
  expect(takeUnsaved("u1")).toBeNull();
  mem.set("vn.unsaved.u1", '{"p": "old format"}');
  expect(takeUnsaved("u1")).toBeNull();
});

it("peek keeps the bodies until cleared", async () => {
  const { peekUnsaved, clearUnsaved } = await import("@/lib/unsaved");
  saveUnsaved("u1", { p: { body: "draft", base: 3 } });
  expect(peekUnsaved("u1")).toEqual({ p: { body: "draft", base: 3 } });
  expect(peekUnsaved("u1")).toEqual({ p: { body: "draft", base: 3 } });
  clearUnsaved("u1");
  expect(peekUnsaved("u1")).toBeNull();
});

it("keeps each account's text apart, and adds to what is kept", () => {
  saveUnsaved("u1", { p: { body: "a", base: 1 } });
  saveUnsaved("u1", { q: { body: "b", base: 2 } });
  expect(takeUnsaved("u2")).toBeNull();
  expect(takeUnsaved("u1")).toEqual({ p: { body: "a", base: 1 }, q: { body: "b", base: 2 } });
});
