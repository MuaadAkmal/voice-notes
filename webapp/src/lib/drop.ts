import type { ItemKind } from "./tree";

export const DRAG_TYPE = "application/x-vn-item";

type DropEvent = {
  dataTransfer: { types: readonly string[]; getData(type: string): string };
  preventDefault(): void;
  stopPropagation(): void;
};

/** True when a drag carries one of our notes, pages or folders. */
export const isOurs = (e: Pick<DropEvent, "dataTransfer">) => e.dataTransfer.types.includes(DRAG_TYPE);

/**
 * Handles a drop onto `folderId` (null = no folder). Stops it here: folder rows sit inside the
 * root target, which would otherwise move the item straight back out.
 */
export function dropOnto(e: DropEvent, folderId: string | null, move: (kind: ItemKind, id: string, folderId: string | null) => void): void {
  if (!isOurs(e)) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    const { kind, id } = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { kind: ItemKind; id: string };
    if (!(kind === "folder" && id === folderId)) move(kind, id, folderId);
  } catch {
    // Not a payload we wrote.
  }
}
