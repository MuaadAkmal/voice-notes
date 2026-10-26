import fs from 'node:fs';
import path from 'node:path';
import { imageRefs } from '../../shared/page-images';
import { applyOp, type FolderRow, type NoteRow, type PageRow, type RowOp } from '../../shared/sync-ops';
import type { NoteStore } from '../store/note-store';
import type { PullResponse, ServerRow } from './engine';

type Prefs = PullResponse['prefs'];

const UPSERT = {
  note: `INSERT INTO notes (id, title, file_path, duration_ms, size_bytes, mime_type, status, created_at, updated_at,
           folder_id, source, kind, window_title, show, starred, transcript, transcript_lang, transcribed_at, version, deleted_at)
         VALUES (@id, @title, @filePath, @durationMs, @sizeBytes, @mimeType, @status, @createdAt, @updatedAt,
           @folderId, @source, @kind, @windowTitle, @show, @starred, @transcript, @transcriptLang, @transcribedAt, @version, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, duration_ms = excluded.duration_ms, size_bytes = excluded.size_bytes,
           mime_type = excluded.mime_type, created_at = excluded.created_at, updated_at = excluded.updated_at,
           folder_id = excluded.folder_id, source = excluded.source, kind = excluded.kind, window_title = excluded.window_title,
           show = excluded.show, starred = excluded.starred, transcript = excluded.transcript,
           transcript_lang = excluded.transcript_lang, transcribed_at = excluded.transcribed_at, version = excluded.version,
           deleted_at = NULL`,
  page: `INSERT INTO pages (id, title, body, folder_id, starred, created_at, updated_at, version, deleted_at)
         VALUES (@id, @title, @body, @folderId, @starred, @createdAt, @updatedAt, @version, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, folder_id = excluded.folder_id,
           starred = excluded.starred, created_at = excluded.created_at, updated_at = excluded.updated_at,
           version = excluded.version, deleted_at = NULL`,
  folder: `INSERT INTO folders (id, name, parent_id, created_at, updated_at, version, deleted_at)
           VALUES (@id, @name, @parentId, @createdAt, @updatedAt, @version, NULL)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id, created_at = excluded.created_at,
             updated_at = excluded.updated_at, version = excluded.version, deleted_at = NULL`,
};
const TABLE = { note: 'notes', page: 'pages', folder: 'folders' } as const;

/**
 * Writes what the server sent, in one transaction, without queueing anything back. Changes this PC
 * hasn't had acked yet are laid on top of the pulled rows, so what the user just did stays visible
 * (and the next pull, after the push, brings the server's verdict). A pulled delete always wins.
 */
export function applyPull(store: NoteStore, res: PullResponse, onPrefs: (prefs: Prefs) => void): void {
  const { sqlite, rootDir, imagesDir } = store.syncAccess();
  const outbox = store.sync.outbox;
  const now = Date.now();
  const goneFiles: string[] = [];
  const goneImages = new Set<string>();

  sqlite.transaction(() => {
    for (const row of res.rows) {
      const table = TABLE[row.entity];
      if (row.deleted) {
        const local = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id) as Record<string, unknown> | undefined;
        if (local && local.deleted_at == null) {
          sqlite.prepare(`UPDATE ${table} SET deleted_at = ?, version = ? WHERE id = ?`).run(now, row.version, row.id);
          if (row.entity === 'note') goneFiles.push(path.join(rootDir, local.file_path as string));
          if (row.entity === 'page') for (const f of imageRefs(local.body as string)) goneImages.add(f);
        }
        sqlite.prepare('DELETE FROM outbox WHERE entity_id = ? AND in_flight = 0').run(row.id);
        continue;
      }
      // The server already has the row, so a create still waiting here would only overwrite it.
      const pending = outbox
        .pending(row.id)
        .map((e) => e.op as RowOp)
        .filter((op) => !op.op.endsWith('.create'));
      const merged = pending.reduce<Record<string, unknown> | undefined>((r, op) => applyOp(r, op), { ...row.data });
      if (!merged) continue; // deleted here, delete not pushed yet: it will win on the server
      write(sqlite, row, merged, rootDir);
    }
    res.prefs.length && onPrefs(res.prefs);
    store.sync.state.setCursor(res.cursor);
  })();

  for (const file of goneFiles) fs.rmSync(file, { force: true });
  if (goneImages.size) {
    for (const p of store.pages.list()) for (const f of imageRefs(p.body)) goneImages.delete(f);
    for (const f of goneImages) fs.rmSync(path.join(imagesDir, f), { force: true });
  }
}

function write(sqlite: ReturnType<NoteStore['syncAccess']>['sqlite'], row: ServerRow, data: Record<string, unknown>, rootDir: string): void {
  const version = row.version;
  if (row.entity === 'note') {
    const n = data as NoteRow;
    const filePath = `recordings/${n.id}.webm`;
    // The audio itself comes in piece C; until then a note from another PC shows as missing audio.
    const status = fs.existsSync(path.join(rootDir, filePath)) ? 'ok' : 'missing';
    sqlite.prepare(UPSERT.note).run({ ...n, filePath, status, starred: n.starred ? 1 : 0, version });
  } else if (row.entity === 'page') {
    const p = data as PageRow;
    sqlite.prepare(UPSERT.page).run({ ...p, starred: p.starred ? 1 : 0, version });
  } else {
    const f = data as FolderRow;
    sqlite.prepare(UPSERT.folder).run({ ...f, version });
  }
}
