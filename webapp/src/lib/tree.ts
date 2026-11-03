import type { FolderRow } from "@wire/sync-ops";
import type { Snapshot } from "@/sync/store";

export type Route =
  | { kind: "page"; id: string }
  | { kind: "note"; id: string }
  | { kind: "folder"; id: string }
  | { kind: "home" }
  | { kind: "view"; view: "inbox" | "starred" | "all" };
export type ItemKind = "note" | "page" | "folder";

export type PageItem = { id: string; title: string };
export type FolderNode = { id: string; name: string; folders: FolderNode[]; pages: PageItem[] };
export type Tree = { folders: FolderNode[]; pages: PageItem[] };
export type ListItem = { kind: "note" | "page"; id: string; title: string; updatedAt: number; starred: boolean };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** The sidebar's files: folders (by name) with their pages; unfiled pages, and pages of a missing folder, at the root. */
export function buildTree(snap: Snapshot): Tree {
  const nodes = new Map<string, FolderNode>();
  for (const { data } of snap.folders.values()) nodes.set(data.id, { id: data.id, name: data.name, folders: [], pages: [] });
  const root: Tree = { folders: [], pages: [] };
  for (const { data } of snap.folders.values()) {
    const parent = data.parentId ? nodes.get(data.parentId) : undefined;
    (parent ? parent.folders : root.folders).push(nodes.get(data.id)!);
  }
  for (const { data } of snap.pages.values()) {
    const parent = data.folderId ? nodes.get(data.folderId) : undefined;
    (parent ? parent.pages : root.pages).push({ id: data.id, title: data.title });
  }
  const sort = (t: Tree) => {
    t.folders.sort((a, b) => byName(a.name, b.name));
    t.pages.sort((a, b) => byName(a.title, b.title));
    t.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** What a list view shows, newest first. */
export function listFor(snap: Snapshot, route: Route): ListItem[] {
  const notes = [...snap.notes.values()].map(({ data }) => ({ kind: "note" as const, id: data.id, title: data.title, updatedAt: data.updatedAt, starred: data.starred, folderId: data.folderId }));
  const pages = [...snap.pages.values()].map(({ data }) => ({ kind: "page" as const, id: data.id, title: data.title, updatedAt: data.updatedAt, starred: data.starred, folderId: data.folderId }));
  let items: typeof notes | (typeof notes[number] | typeof pages[number])[] = [];
  if (route.kind === "view" && route.view === "inbox") items = notes.filter((n) => n.folderId === null);
  else if (route.kind === "view" && route.view === "all") items = notes;
  else if (route.kind === "view" && route.view === "starred") items = [...notes, ...pages].filter((i) => i.starred);
  else if (route.kind === "folder") items = [...notes, ...pages].filter((i) => i.folderId === route.id);
  return items
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ kind, id, title, updatedAt, starred }) => ({ kind, id, title, updatedAt, starred }));
}

/** The folders from the top down to `id`. */
export function folderPath(snap: Snapshot, id: string | null): FolderRow[] {
  const path: FolderRow[] = [];
  for (let at = id, hops = 0; at && hops < 100; hops++) {
    const f = snap.folders.get(at)?.data;
    if (!f) break;
    path.unshift(f);
    at = f.parentId;
  }
  return path;
}

/** Whether folder `id` is `ancestor` or sits somewhere inside it. */
export function isInside(snap: Snapshot, id: string, ancestor: string): boolean {
  return folderPath(snap, id).some((f) => f.id === ancestor);
}
