import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Note, NoteKind, RecordingSource } from '../../shared/ipc';
import { defaultTitle } from '../../shared/format';
import { FolderStore } from './folder-store';
import { migrate } from './migrations';
import { PageStore } from './page-store';
import { DictationStore } from './dictation-store';
import { PomodoroStore } from './pomodoro-store';
import { ReminderStore } from './reminder-store';
import { FileOutbox } from '../sync/file-outbox';
import { Outbox } from '../sync/outbox';
import { SyncState } from '../sync/state';
import type { NoteRow, SyncOp } from '../../shared/sync-ops';

type NoteFields = Extract<SyncOp, { op: 'note.update' }>['fields'];
import { liveColumns, notes } from './schema';

const noteColumns = liveColumns(getTableColumns(notes));
const live = isNull(notes.deletedAt);
const TOMBSTONE_TTL_MS = 30 * 86_400_000;

export type NewAudio = {
  bytes: Buffer;
  durationMs: number;
  mimeType: string;
  source: RecordingSource;
  kind?: NoteKind;
  windowTitle?: string | null;
  show?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORPHAN_MIME = 'audio/webm;codecs=opus';

export class NoteStore {
  readonly recordingsDir: string;
  readonly imagesDir: string;
  readonly folders: FolderStore;
  readonly pages: PageStore;
  readonly dictations: DictationStore;
  readonly pomodoro: PomodoroStore;
  readonly reminders: ReminderStore;
  /** Every change is also queued here (while sync is on) for the other PCs. */
  readonly sync: { state: SyncState; outbox: Outbox; files: FileOutbox };

  private constructor(
    private readonly rootDir: string,
    private readonly sqlite: Database.Database,
    private readonly db: BetterSQLite3Database,
    private readonly now: () => number,
    hostname: () => string,
  ) {
    this.recordingsDir = path.join(rootDir, 'recordings');
    this.imagesDir = path.join(rootDir, 'images');
    const state = new SyncState(sqlite, hostname);
    this.sync = { state, outbox: new Outbox(sqlite, state, now), files: new FileOutbox(sqlite, state, now) };
    this.folders = new FolderStore(db, sqlite, now, this.sync.outbox);
    this.pages = new PageStore(db, sqlite, now, this.folders, this.imagesDir, this.sync.outbox, this.sync.files);
    this.dictations = new DictationStore(db, now);
    this.pomodoro = new PomodoroStore(db, now);
    this.reminders = new ReminderStore(db, now);
  }

  static open(rootDir: string, now: () => number = Date.now, hostname: () => string = os.hostname): NoteStore {
    fs.mkdirSync(path.join(rootDir, 'recordings'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'images'), { recursive: true });
    const sqlite = new Database(path.join(rootDir, 'voice-notes.sqlite'));
    sqlite.pragma('journal_mode = WAL');
    migrate(sqlite);
    return new NoteStore(rootDir, sqlite, drizzle(sqlite), now, hostname);
  }

  /** Writes <id>.webm.tmp, fsyncs, renames, then inserts the row. A crash leaves an orphan reconcile() adopts. */
  async create(audio: NewAudio): Promise<Note> {
    const id = randomUUID();
    const relPath = `recordings/${id}.webm`;
    const finalPath = path.join(this.rootDir, relPath);
    const tmpPath = `${finalPath}.tmp`;
    const fh = await fs.promises.open(tmpPath, 'w');
    try {
      await fh.writeFile(audio.bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tmpPath, finalPath);
    const ts = this.now();
    const note: Note = {
      id,
      title: defaultTitle(new Date(ts)),
      filePath: relPath,
      durationMs: Math.round(audio.durationMs),
      sizeBytes: audio.bytes.length,
      mimeType: audio.mimeType,
      status: 'ok',
      createdAt: ts,
      updatedAt: ts,
      syncedAt: null,
      folderId: null,
      source: audio.source,
      kind: audio.kind ?? 'note',
      windowTitle: audio.windowTitle ?? null,
      show: audio.show ?? null,
      starred: false,
      transcript: null,
      transcriptLang: null,
      transcribedAt: null,
    };
    this.sqlite.transaction(() => {
      this.db.insert(notes).values(note).run();
      this.sync.outbox.record({ op: 'note.create', id, row: toRow(note) }, 0);
      this.sync.files.record('audio', `${id}.webm`);
    })();
    return note;
  }

  list(): Note[] {
    return this.db.select(noteColumns).from(notes).where(live).orderBy(desc(notes.createdAt)).all();
  }

  get(id: string): Note | undefined {
    return this.db.select(noteColumns).from(notes).where(and(eq(notes.id, id), live)).get();
  }

  rename(id: string, title: string): Note {
    return this.sqlite.transaction(() => {
      const updated = this.db
        .update(notes)
        .set({ title, updatedAt: this.now() })
        .where(and(eq(notes.id, id), live))
        .returning(noteColumns)
        .get();
      if (!updated) throw new Error('Note not found');
      this.recordUpdate(id, { title, updatedAt: updated.updatedAt });
      return updated;
    })();
  }

  /** Unknown note ids are ignored. */
  setStarred(ids: string[], starred: boolean): void {
    this.sqlite.transaction(() => {
      const updatedAt = this.now();
      const changed = this.db
        .update(notes)
        .set({ starred, updatedAt })
        .where(and(inArray(notes.id, ids), live))
        .returning({ id: notes.id })
        .all();
      for (const { id } of changed) this.recordUpdate(id, { starred, updatedAt });
    })();
  }

  /** null clears the label (the raw window title is kept). */
  setShow(id: string, show: string | null): Note {
    return this.sqlite.transaction(() => {
      const updated = this.db
        .update(notes)
        .set({ show, updatedAt: this.now() })
        .where(and(eq(notes.id, id), live))
        .returning(noteColumns)
        .get();
      if (!updated) throw new Error('Note not found');
      this.recordUpdate(id, { show, updatedAt: updated.updatedAt });
      return updated;
    })();
  }

  /** A fresh transcription result. Not an edit of the note, so updatedAt (sort order) stays. */
  setTranscript(id: string, text: string, lang: string | null): Note {
    return this.updateTranscript(id, { transcript: text, transcriptLang: lang, transcribedAt: this.now() });
  }

  /** The user correcting the text: language and time of transcription are kept. */
  editTranscript(id: string, text: string): Note {
    return this.updateTranscript(id, { transcript: text });
  }

  private updateTranscript(id: string, patch: Pick<Partial<Note>, 'transcript' | 'transcriptLang' | 'transcribedAt'>): Note {
    return this.sqlite.transaction(() => {
      const updated = this.db.update(notes).set(patch).where(and(eq(notes.id, id), live)).returning(noteColumns).get();
      if (!updated) throw new Error('Note not found');
      this.recordUpdate(id, patch);
      return updated;
    })();
  }

  private recordUpdate(id: string, fields: NoteFields): void {
    this.sync.outbox.record({ op: 'note.update', id, fields }, this.sync.outbox.rowVersion('note', id));
  }

  async delete(id: string): Promise<void> {
    const note = this.get(id);
    if (!note) return;
    await fs.promises.rm(this.absolutePath(note), { force: true });
    // A tombstone, so the delete can reach other PCs; purgeTombstones() removes it later.
    this.sqlite.transaction(() => {
      this.db.update(notes).set({ deletedAt: this.now() }).where(eq(notes.id, id)).run();
      this.sync.outbox.record({ op: 'note.delete', id }, this.sync.outbox.rowVersion('note', id));
      this.sync.files.remove('audio', `${id}.webm`);
    })();
  }

  /** folderId null = Inbox. Unknown note ids are ignored. */
  moveNotes(ids: string[], folderId: string | null): void {
    if (folderId && !this.folders.get(folderId)) throw new Error('Folder not found');
    this.sqlite.transaction(() => {
      const updatedAt = this.now();
      const changed = this.db
        .update(notes)
        .set({ folderId, updatedAt })
        .where(and(inArray(notes.id, ids), live))
        .returning({ id: notes.id })
        .all();
      for (const { id } of changed) this.recordUpdate(id, { folderId, updatedAt });
    })();
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) await this.delete(id);
  }

  async reconcile(): Promise<{ missing: number; adopted: number; tmpRemoved: number }> {
    const result = { missing: 0, adopted: 0, tmpRemoved: 0 };
    const files = await fs.promises.readdir(this.recordingsDir);

    for (const f of files.filter((f) => f.endsWith('.tmp'))) {
      await fs.promises.rm(path.join(this.recordingsDir, f), { force: true });
      result.tmpRemoved++;
    }

    // Tombstoned ids count as known: a deleted note's file must never be adopted back.
    const known = new Set(this.db.select({ id: notes.id }).from(notes).all().map((r) => r.id));
    const deleted = new Set(
      this.db.select({ id: notes.id }).from(notes).where(isNotNull(notes.deletedAt)).all().map((r) => r.id),
    );
    // A deleted note's audio left behind (Windows held it open when the delete came in): remove it now.
    for (const f of files) {
      if (!f.endsWith('.webm') || !deleted.has(f.slice(0, -'.webm'.length))) continue;
      try {
        await fs.promises.rm(path.join(this.recordingsDir, f), { force: true });
      } catch {
        // still held open: next boot
      }
    }
    for (const note of this.list()) {
      const exists = fs.existsSync(this.absolutePath(note));
      // A remote note's audio is in the account: it isn't lost, just not downloaded yet.
      const status = exists ? 'ok' : note.status === 'remote' ? 'remote' : 'missing';
      if (status !== note.status) {
        this.db.update(notes).set({ status }).where(eq(notes.id, note.id)).run();
        if (status === 'missing') result.missing++;
      }
    }

    for (const f of files) {
      if (!f.endsWith('.webm')) continue;
      const id = f.slice(0, -'.webm'.length);
      if (!UUID_RE.test(id) || known.has(id)) continue;
      const stat = await fs.promises.stat(path.join(this.recordingsDir, f));
      const createdAt = Math.round(stat.mtimeMs);
      this.db
        .insert(notes)
        .values({
          id,
          title: defaultTitle(new Date(createdAt)),
          filePath: `recordings/${f}`,
          durationMs: 0,
          sizeBytes: stat.size,
          mimeType: ORPHAN_MIME,
          status: 'ok',
          createdAt,
          updatedAt: createdAt,
          syncedAt: null,
          folderId: null,
          source: 'mic',
        })
        .run();
      result.adopted++;
    }
    return result;
  }

  /** Drops tombstones older than 30 days whose delete is no longer waiting in the outbox. */
  purgeTombstones(now: number): number {
    let removed = 0;
    for (const table of ['notes', 'pages', 'folders']) {
      removed += this.sqlite
        .prepare(
          `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ? AND id NOT IN (SELECT entity_id FROM outbox)`,
        )
        .run(now - TOMBSTONE_TTL_MS).changes;
    }
    return removed;
  }

  /** For src/main/sync only: pulled rows are written straight to the tables, without recording. */
  syncAccess(): { sqlite: Database.Database; rootDir: string; imagesDir: string } {
    return { sqlite: this.sqlite, rootDir: this.rootDir, imagesDir: this.imagesDir };
  }

  absolutePath(note: Note): string {
    return path.join(this.rootDir, note.filePath);
  }

  close(): void {
    this.sqlite.close();
  }
}

/** A note as it syncs: where its audio sits on this PC is local. */
export function toRow(note: Note): NoteRow {
  const { filePath: _f, status: _s, syncedAt: _y, ...row } = note;
  return row;
}
