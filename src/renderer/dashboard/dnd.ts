// What is being dragged right now. dataTransfer contents are unreadable during dragover,
// so drop targets consult this to decide whether to highlight and accept.
// Dragged list rows: voice note ids and page ids, kept apart because they move through different APIs.
export type Dragging = { kind: 'notes'; ids: string[]; pageIds: string[] } | { kind: 'folder'; id: string } | null;

export const NOTES_MIME = 'application/x-vn-notes';
export const FOLDER_MIME = 'application/x-vn-folder';

let current: Dragging = null;
const droppedListeners = new Set<() => void>();

export const getDragging = (): Dragging => current;

export function setDragging(d: Dragging): void {
  current = d;
}

/** Called by a drop target after a successful move, e.g. so the notes list can clear its selection. */
export function notifyDropped(): void {
  current = null;
  droppedListeners.forEach((l) => l());
}

export function onDropped(listener: () => void): () => void {
  droppedListeners.add(listener);
  return () => droppedListeners.delete(listener);
}

/** A small "3 notes" chip as the drag image when several notes are dragged. */
export function setCountDragImage(e: React.DragEvent, count: number): void {
  if (count < 2) return;
  const chip = document.createElement('div');
  chip.textContent = `${count} notes`;
  chip.style.cssText =
    'position:fixed;top:-100px;left:0;padding:4px 10px;border-radius:9999px;background:#1c1917;color:#fff;font:500 12px system-ui';
  document.body.appendChild(chip);
  e.dataTransfer.setDragImage(chip, 10, 10);
  requestAnimationFrame(() => chip.remove());
}
