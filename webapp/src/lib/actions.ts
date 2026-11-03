import type { WebOp } from "./apply-op";
import { isInside, type ItemKind } from "./tree";
import type { Snapshot } from "@/sync/store";

type Editor = { edit(op: WebOp): void };

/** The built-in Review later and Quick notes pages can't be deleted (the PCs would only make them again). */
export function canDelete(snap: Snapshot, kind: ItemKind, id: string): boolean {
  return !(kind === "page" && (id === snap.laterPageId || id === snap.notesPageId));
}

export function newPage(engine: Editor, folderId: string | null, now = Date.now()): string {
  const id = crypto.randomUUID();
  engine.edit({ op: "page.create", id, row: { id, title: "Untitled", body: "", folderId, starred: false, createdAt: now, updatedAt: now } });
  return id;
}

export function newFolder(engine: Editor, parentId: string | null, name: string, now = Date.now()): string {
  const id = crypto.randomUUID();
  engine.edit({ op: "folder.create", id, row: { id, name: name.trim() || "New folder", parentId, createdAt: now, updatedAt: now } });
  return id;
}

export function renameItem(engine: Editor, kind: ItemKind, id: string, name: string, now = Date.now()): void {
  const value = name.trim();
  if (!value) return;
  if (kind === "folder") engine.edit({ op: "folder.update", id, fields: { name: value, updatedAt: now } });
  else if (kind === "page") engine.edit({ op: "page.update", id, fields: { title: value, updatedAt: now } });
  else engine.edit({ op: "note.update", id, fields: { title: value, updatedAt: now } });
}

export function toggleStar(engine: Editor, snap: Snapshot, kind: "note" | "page", id: string, now = Date.now()): void {
  if (kind === "page") {
    const page = snap.pages.get(id)?.data;
    if (page) engine.edit({ op: "page.update", id, fields: { starred: !page.starred, updatedAt: now } });
  } else {
    const note = snap.notes.get(id)?.data;
    if (note) engine.edit({ op: "note.update", id, fields: { starred: !note.starred, updatedAt: now } });
  }
}

/** Into `folderId` (null = no folder). A folder never moves into itself or below itself. */
export function moveItem(engine: Editor, snap: Snapshot, kind: ItemKind, id: string, folderId: string | null, now = Date.now()): void {
  if (kind === "folder") {
    if (folderId && isInside(snap, folderId, id)) return;
    engine.edit({ op: "folder.update", id, fields: { parentId: folderId, updatedAt: now } });
  } else if (kind === "page") engine.edit({ op: "page.update", id, fields: { folderId, updatedAt: now } });
  else engine.edit({ op: "note.update", id, fields: { folderId, updatedAt: now } });
}

/** False when the item can't be deleted. */
export function deleteItem(engine: Editor, snap: Snapshot, kind: ItemKind, id: string): boolean {
  if (!canDelete(snap, kind, id)) return false;
  engine.edit(kind === "folder" ? { op: "folder.delete", id } : kind === "page" ? { op: "page.delete", id } : { op: "note.delete", id });
  return true;
}
