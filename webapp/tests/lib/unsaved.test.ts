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
  saveUnsaved({ p: { body: "draft", base: 3 } });
  expect(takeUnsaved()).toEqual({ p: { body: "draft", base: 3 } });
  expect(takeUnsaved()).toBeNull();
});

it("nothing saved, an empty map, or garbage is null", () => {
  saveUnsaved({});
  expect(takeUnsaved()).toBeNull();
  mem.set("vn.unsaved", "{not json");
  expect(takeUnsaved()).toBeNull();
  mem.set("vn.unsaved", '{"p": "old format"}');
  expect(takeUnsaved()).toBeNull();
});

it("peek keeps the bodies until cleared", async () => {
  const { peekUnsaved, clearUnsaved } = await import("@/lib/unsaved");
  saveUnsaved({ p: { body: "draft", base: 3 } });
  expect(peekUnsaved()).toEqual({ p: { body: "draft", base: 3 } });
  expect(peekUnsaved()).toEqual({ p: { body: "draft", base: 3 } });
  clearUnsaved();
  expect(peekUnsaved()).toBeNull();
});
