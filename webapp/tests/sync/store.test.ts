import { expect, it } from "vitest";
import type { PullResponse } from "@wire/sync/protocol";
import type { PageRow } from "@wire/sync-ops";
import { WebStore } from "@/sync/store";

const page = (id: string, title: string): PageRow => ({ id, title, body: "", folderId: null, starred: false, createdAt: 1, updatedAt: 1 });
const pull = (rows: PullResponse["rows"], prefs: PullResponse["prefs"] = [], cursor = 9): PullResponse => ({ cursor, hasMore: false, rows, prefs });

it("writes pulled rows, removes deleted ones, takes prefs and the cursor", () => {
  const s = new WebStore();
  s.applyPull(pull([{ entity: "page", id: "a", version: 2, deleted: false, data: page("a", "A") }], [{ key: "laterPageId", value: "a", version: 3 }]), []);
  expect(s.snapshot().pages.get("a")).toEqual({ data: page("a", "A"), version: 2 });
  expect(s.snapshot().laterPageId).toBe("a");
  expect(s.snapshot().cursor).toBe(9);
  s.applyPull(pull([{ entity: "page", id: "a", version: 4, deleted: true, data: null }]), []);
  expect(s.snapshot().pages.has("a")).toBe(false);
});

it("lays unacked local edits back over pulled rows", () => {
  const s = new WebStore();
  s.applyPull(pull([{ entity: "page", id: "a", version: 2, deleted: false, data: page("a", "A") }]), []);
  const mine = { op: "page.update" as const, id: "a", fields: { title: "Mine" } };
  s.applyLocal(mine);
  s.applyPull(pull([{ entity: "page", id: "a", version: 5, deleted: false, data: page("a", "Theirs") }]), [mine]);
  expect(s.snapshot().pages.get("a")).toEqual({ data: page("a", "Mine"), version: 5 });
});

it("gives React a stable snapshot until something changes", () => {
  const s = new WebStore();
  const before = s.snapshot();
  expect(s.snapshot()).toBe(before);
  let calls = 0;
  s.subscribe(() => calls++);
  s.applyLocal({ op: "page.create", id: "b", row: page("b", "B") });
  expect(s.snapshot()).not.toBe(before);
  expect(s.snapshot().pages.get("b")?.version).toBe(0);
  expect(calls).toBe(1);
  s.setVersion("page", "b", 8);
  expect(s.version("page", "b")).toBe(8);
  expect(s.version("note", "zzz")).toBe(0);
});
