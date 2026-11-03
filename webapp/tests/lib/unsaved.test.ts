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
  saveUnsaved({ p: "draft" });
  expect(takeUnsaved()).toEqual({ p: "draft" });
  expect(takeUnsaved()).toBeNull();
});

it("nothing saved, an empty map, or garbage is null", () => {
  saveUnsaved({});
  expect(takeUnsaved()).toBeNull();
  mem.set("vn.unsaved", "{not json");
  expect(takeUnsaved()).toBeNull();
  mem.set("vn.unsaved", '{"p": 3}');
  expect(takeUnsaved()).toBeNull();
});
