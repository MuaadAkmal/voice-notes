import type { Folder, Note, Page } from './channels';
import { appendEntry, appendLine } from './learn-log';
import { setTaskChecked } from './task-lines';

// The changes one PC sends the other through the server, and how each one changes a row.
// Pure: used by the desktop when it lays unsent changes over pulled rows, and by the server.

/** A note as it syncs: where its audio sits on this PC (path, status) is local only. */
export type NoteRow = Omit<Note, 'filePath' | 'status' | 'syncedAt'>;
export type PageRow = Page;
export type FolderRow = Folder;

/** Settings that follow the account; everything else in settings.json stays on this PC. */
export const SYNCED_KEYS = ['homeWidgets', 'transcribeLanguage', 'laterPageId', 'notesPageId'] as const;
export type SyncedKey = (typeof SYNCED_KEYS)[number];

// updatedAt travels with a change (the sender's clock; it only sorts lists, never orders changes).
type NoteFields = Partial<Pick<NoteRow, 'title' | 'folderId' | 'starred' | 'show' | 'transcript' | 'transcriptLang' | 'transcribedAt' | 'updatedAt'>>;
type PageFields = Partial<Pick<PageRow, 'title' | 'folderId' | 'starred' | 'updatedAt'>>;
type FolderFields = Partial<Pick<FolderRow, 'name' | 'parentId' | 'updatedAt'>>;

export type SyncOp =
  | { op: 'note.create'; id: string; row: NoteRow } // audio key: `${id}.webm`
  | { op: 'note.update'; id: string; fields: NoteFields }
  | { op: 'note.delete'; id: string }
  | { op: 'page.create'; id: string; row: PageRow }
  | { op: 'page.update'; id: string; fields: PageFields }
  // at: when the body changed on the sender (becomes updatedAt)
  | { op: 'page.setBody'; id: string; body: string; at?: number }
  | { op: 'page.append'; id: string; text: string; day: string; at?: number } // day: local 'YYYY-MM-DD' it was added on
  | { op: 'page.appendLine'; id: string; text: string; at?: number } // a plain `- text` as the last line
  | { op: 'page.setTask'; id: string; line: number; lineText: string; checked: boolean; at?: number }
  | { op: 'page.delete'; id: string }
  | { op: 'folder.create'; id: string; row: FolderRow }
  | { op: 'folder.update'; id: string; fields: FolderFields }
  | { op: 'folder.delete'; id: string }
  | { op: 'prefs.set'; key: SyncedKey; value: unknown };

export type RowOp = Exclude<SyncOp, { op: 'prefs.set' }>;

/** The row after `op`; undefined once deleted. */
export function applyOp<T>(row: T | undefined, op: RowOp): T | undefined {
  switch (op.op) {
    case 'note.create':
    case 'page.create':
    case 'folder.create':
      return op.row as T;
    case 'note.delete':
    case 'page.delete':
    case 'folder.delete':
      return undefined;
    case 'note.update':
    case 'page.update':
    case 'folder.update':
      return row && { ...row, ...op.fields };
    case 'page.setBody':
      return row && ({ ...row, body: op.body, ...stamp(op.at) } as T);
    case 'page.append': {
      const page = row as PageRow | undefined;
      return page && ({ ...page, body: appendOnDay(page.body, op.text, op.day), ...stamp(op.at) } as T);
    }
    case 'page.appendLine': {
      const page = row as PageRow | undefined;
      return page && ({ ...page, body: appendLine(page.body, op.text), ...stamp(op.at) } as T);
    }
    case 'page.setTask': {
      const page = row as PageRow | undefined;
      return page && ({ ...page, body: setTaskByText(page.body, op.line, op.lineText, op.checked), ...stamp(op.at) } as T);
    }
  }
}

const stamp = (at: number | undefined) => (at === undefined ? {} : { updatedAt: at });

/** learn-log's append, under the heading of `day` rather than of today. */
export function appendOnDay(body: string, text: string, day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return appendEntry(body, text, new Date(y, m - 1, d));
}

const BOX = /^(\s*(?:[-*+]|\d+[.)]) +\[)[ xX](\])/;

/** A task line with its box blanked, so a ticked and an unticked line compare equal. */
export function taskText(line: string): string {
  return line.replace(BOX, '$1 $2');
}

/**
 * Ticks the task the sender saw at `line`. The lines may have shifted since (an append or an edit
 * on another PC), so the line is found by its text: at `line` if it still matches, else the one
 * line that does. Ambiguous or gone: the body is left as it is.
 */
export function setTaskByText(body: string, line: number, lineText: string, checked: boolean): string {
  const lines = body.split('\n');
  let index = taskText(lines[line] ?? '') === lineText ? line : -1;
  if (index < 0) {
    const matches = lines.flatMap((l, i) => (taskText(l) === lineText ? [i] : []));
    if (matches.length !== 1) return body;
    index = matches[0];
  }
  return setTaskChecked(body, index, checked) ?? body;
}

/** Local 'YYYY-MM-DD'. */
export function localDay(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
