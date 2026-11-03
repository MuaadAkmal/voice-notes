import { expect, it } from "vitest";
import type { PageRow } from "@wire/sync-ops";
import { homeCards } from "@/lib/home";
import type { Snapshot } from "@/sync/store";

const page = (id: string): PageRow => ({ id, title: id, body: "", folderId: null, starred: false, createdAt: 1, updatedAt: 1 });
const snap = (homeWidgets: unknown): Snapshot =>
  ({
    pages: new Map(["a", "b"].map((id) => [id, { data: page(id), version: 1 }])),
    notes: new Map(),
    folders: new Map(),
    laterPageId: null,
    notesPageId: null,
    homeWidgets,
    cursor: 0,
    loaded: true,
  }) as unknown as Snapshot;

it("keeps page and quick-add cards in order, with the desktop's default sizes", () => {
  const cards = homeCards(
    snap([
      { id: "1", type: "quick-add", pageId: "a", label: "a", locked: true },
      { id: "2", type: "calendar" },
      { id: "3", type: "page", pageId: "b", w: 3, h: 1 },
      { id: "4", type: "page", pageId: "gone" },
      { id: "5", type: "reminders" },
      { id: "6", type: "page", pageId: "a" },
    ]),
  );
  expect(cards).toEqual([
    { id: "1", type: "quick-add", pageId: "a", w: 1, h: 2 },
    { id: "3", type: "page", pageId: "b", w: 3, h: 1 },
    { id: "6", type: "page", pageId: "a", w: 2, h: 2 },
  ]);
});

it("an unset or malformed setting is no cards", () => {
  expect(homeCards(snap(null))).toEqual([]);
  expect(homeCards(snap("nope"))).toEqual([]);
  expect(homeCards(snap([{ id: "x", type: "page", pageId: 3 }, null, { id: "y", type: "page", pageId: "a", w: 9, h: 0 }]))).toEqual([
    { id: "y", type: "page", pageId: "a", w: 2, h: 2 },
  ]);
});
