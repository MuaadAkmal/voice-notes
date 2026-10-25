import type { Note, Page } from './channels';

/** One row of the merged notes list: a voice note or a text page. */
export type Item = { type: 'audio'; note: Note } | { type: 'page'; page: Page };

export const itemId = (i: Item): string =>
  i.type === 'audio' ? i.note.id : i.page.id;
/** Audio sorts by when it was recorded, pages by when they were last edited. */
export const itemTime = (i: Item): number =>
  i.type === 'audio' ? i.note.createdAt : i.page.updatedAt;
export const itemFolderId = (i: Item): string | null =>
  i.type === 'audio' ? i.note.folderId : i.page.folderId;
export const itemStarred = (i: Item): boolean =>
  i.type === 'audio' ? i.note.starred : i.page.starred;

/** Newest first; on a tie notes come before pages. */
export function mergeItems(notes: Note[], pages: Page[]): Item[] {
  const items: Item[] = [
    ...notes.map((note): Item => ({ type: 'audio', note })),
    ...pages.map((page): Item => ({ type: 'page', page })),
  ];
  return items.sort((a, b) => itemTime(b) - itemTime(a)); // stable: ties keep notes first
}

/** Selected voice notes the bulk Transcribe should send: never one that already has a (possibly edited) transcript. */
export const untranscribedIds = (items: Item[], selected: ReadonlySet<string>): string[] =>
  items.flatMap((i) =>
    i.type === 'audio' && selected.has(i.note.id) && i.note.status === 'ok' && i.note.transcript === null
      ? [i.note.id]
      : [],
  );
