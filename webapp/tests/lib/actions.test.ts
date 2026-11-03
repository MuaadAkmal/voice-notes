import { expect, it } from "vitest";
import type { FolderRow, PageRow } from "@wire/sync-ops";
import type { WebOp } from "@/lib/apply-op";
import { canDelete, deleteItem, moveItem, newFolder, newPage, renameItem, toggleStar } from "@/lib/actions";
import type { Snapshot } from "@/sync/store";

const page = (id: string): PageRow => ({ id, title: id, body: "", folderId: null, starred: false, createdAt: 1, updatedAt: 1 });
const folder = (id: string, parentId: string | null = null): FolderRow => ({ id, name: id, parentId, createdAt: 1, updatedAt: 1 });
const snap = {
  pages: new Map([["later", { data: page("later"), version: 1 }], ["p", { data: page("p"), version: 1 }]]),
  notes: new Map([["n", { data: { id: "n", starred: true }, version: 1 }]]),
  folders: new Map([["a", { data: folder("a"), version: 1 }], ["b", { data: folder("b", "a"), version: 1 }]]),
  laterPageId: "later",
  notesPageId: "quick",
  cursor: 0,
  loaded: true,
} as unknown as Snapshot;

function fake() {
  const ops: WebOp[] = [];
  return { ops, engine: { edit: (op: WebOp) => void ops.push(op) } };
}
const NOW = 42;

it("creates an empty page in the folder you're in", () => {
  const { ops, engine } = fake();
  const id = newPage(engine, "f", NOW);
  expect(ops).toEqual([{ op: "page.create", id, row: { id, title: "Untitled", body: "", folderId: "f", starred: false, createdAt: NOW, updatedAt: NOW } }]);
});

it("never deletes the built-in pages", () => {
  const { ops, engine } = fake();
  expect(canDelete(snap, "page", "later")).toBe(false);
  expect(canDelete(snap, "page", "quick")).toBe(false);
  expect(deleteItem(engine, snap, "page", "later")).toBe(false);
  expect(ops).toEqual([]);
  expect(deleteItem(engine, snap, "page", "p")).toBe(true);
  expect(ops).toEqual([{ op: "page.delete", id: "p" }]);
});

it("moves notes and pages by folderId, folders by parentId, never into themselves", () => {
  const { ops, engine } = fake();
  moveItem(engine, snap, "note", "n", "a", NOW);
  moveItem(engine, snap, "folder", "a", "b", NOW);
  moveItem(engine, snap, "folder", "b", null, NOW);
  expect(ops).toEqual([
    { op: "note.update", id: "n", fields: { folderId: "a", updatedAt: NOW } },
    { op: "folder.update", id: "b", fields: { parentId: null, updatedAt: NOW } },
  ]);
});

it("renames, stars and makes folders", () => {
  const { ops, engine } = fake();
  renameItem(engine, "folder", "a", "  New  ", NOW);
  renameItem(engine, "page", "p", "   ", NOW);
  toggleStar(engine, snap, "note", "n", NOW);
  const id = newFolder(engine, "a", "Kids", NOW);
  expect(ops).toEqual([
    { op: "folder.update", id: "a", fields: { name: "New", updatedAt: NOW } },
    { op: "note.update", id: "n", fields: { starred: false, updatedAt: NOW } },
    { op: "folder.create", id, row: { id, name: "Kids", parentId: "a", createdAt: NOW, updatedAt: NOW } },
  ]);
});
