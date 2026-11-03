import { expect, it } from "vitest";
import type { FolderRow, NoteRow, PageRow } from "@wire/sync-ops";
import type { Snapshot } from "@/sync/store";
import { buildTree, folderPath, isInside, listFor } from "@/lib/tree";

const v = <T,>(data: T) => ({ data, version: 1 });
const folder = (id: string, name: string, parentId: string | null = null): FolderRow => ({ id, name, parentId, createdAt: 1, updatedAt: 1 });
const page = (id: string, title: string, folderId: string | null = null, updatedAt = 1, starred = false): PageRow => ({ id, title, body: "", folderId, starred, createdAt: 1, updatedAt });
const note = (id: string, folderId: string | null, updatedAt: number, starred = false) => ({ id, title: id, folderId, starred, updatedAt }) as unknown as NoteRow;

function snap(folders: FolderRow[], pages: PageRow[], notes: NoteRow[] = []): Snapshot {
  return {
    folders: new Map(folders.map((f) => [f.id, v(f)])),
    pages: new Map(pages.map((p) => [p.id, v(p)])),
    notes: new Map(notes.map((n) => [n.id, v(n)])),
    laterPageId: null,
    notesPageId: null,
    cursor: 0,
    loaded: true,
  };
}

it("nests folders sorted by name, with their pages; unfiled and orphaned pages at the root", () => {
  const s = snap(
    [folder("b", "beta"), folder("a", "Alpha"), folder("c", "child", "a")],
    [page("p1", "Zed", "c"), page("p2", "apple"), page("p3", "lost", "gone"), page("p4", "In alpha", "a")],
  );
  const tree = buildTree(s);
  expect(tree.folders.map((f) => f.name)).toEqual(["Alpha", "beta"]);
  expect(tree.folders[0].folders.map((f) => f.name)).toEqual(["child"]);
  expect(tree.folders[0].folders[0].pages.map((p) => p.id)).toEqual(["p1"]);
  expect(tree.folders[0].pages.map((p) => p.id)).toEqual(["p4"]);
  expect(tree.pages.map((p) => p.title)).toEqual(["apple", "lost"]);
});

it("lists newest first: inbox = unfiled notes, starred = both kinds, folder = both kinds inside", () => {
  const s = snap([folder("f", "F")], [page("p", "P", "f", 5, true)], [note("n1", null, 3), note("n2", "f", 9, true), note("n3", null, 7)]);
  expect(listFor(s, { kind: "view", view: "inbox" }).map((i) => i.id)).toEqual(["n3", "n1"]);
  expect(listFor(s, { kind: "view", view: "all" }).map((i) => i.id)).toEqual(["n2", "n3", "n1"]);
  expect(listFor(s, { kind: "view", view: "starred" }).map((i) => i.id)).toEqual(["n2", "p"]);
  expect(listFor(s, { kind: "folder", id: "f" }).map((i) => `${i.kind}:${i.id}`)).toEqual(["note:n2", "page:p"]);
});

it("knows folder paths and nesting", () => {
  const s = snap([folder("a", "A"), folder("b", "B", "a"), folder("c", "C", "b")], []);
  expect(folderPath(s, "c").map((f) => f.name)).toEqual(["A", "B", "C"]);
  expect(isInside(s, "c", "a")).toBe(true);
  expect(isInside(s, "a", "c")).toBe(false);
  expect(isInside(s, "a", "a")).toBe(true);
});
