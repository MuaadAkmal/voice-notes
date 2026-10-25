import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Note, NoteKind, RecordingSource } from '../../shared/ipc';
import { defaultTitle } from '../../shared/format';
import { FolderStore } from './folder-store';
import { migrate } from './migrations';
import { PageStore } from './page-store';
import { notes } from './schema';

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

  private constructor(
    private readonly rootDir: string,
    private readonly sqlite: Database.Database,
    private readonly db: BetterSQLite3Database,
    private readonly now: () => number,
  ) {
    this.recordingsDir = path.join(rootDir, 'recordings');
    this.imagesDir = path.join(rootDir, 'images');
    this.folders = new FolderStore(db, sqlite, now);
    this.pages = new PageStore(db, sqlite, now, this.folders, this.imagesDir);
  }

  static open(rootDir: string, now: () => number = Date.now): NoteStore {
    fs.mkdirSync(path.join(rootDir, 'recordings'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'images'), { recursive: true });
    const sqlite = new Database(path.join(rootDir, 'voice-notes.sqlite'));
    sqlite.pragma('journal_mode = WAL');
    migrate(sqlite);
    return new NoteStore(rootDir, sqlite, drizzle(sqlite), now);
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
    this.db.insert(notes).values(note).run();
    return note;
  }

  list(): Note[] {
    return this.db.select().from(notes).orderBy(desc(notes.createdAt)).all();
  }

  get(id: string): Note | undefined {
    return this.db.select().from(notes).where(eq(notes.id, id)).get();
  }

  rename(id: string, title: string): Note {
    const updated = this.db
      .update(notes)
      .set({ title, updatedAt: this.now() })
      .where(eq(notes.id, id))
      .returning()
      .get();
    if (!updated) throw new Error('Note not found');
    return updated;
  }

  /** Unknown note ids are ignored. */
  setStarred(ids: string[], starred: boolean): void {
    this.db.update(notes).set({ starred, updatedAt: this.now() }).where(inArray(notes.id, ids)).run();
  }

  /** null clears the label (the raw window title is kept). */
  setShow(id: string, show: string | null): Note {
    const updated = this.db
      .update(notes)
      .set({ show, updatedAt: this.now() })
      .where(eq(notes.id, id))
      .returning()
      .get();
    if (!updated) throw new Error('Note not found');
    return updated;
  }

  /** A fresh transcription result. Not an edit of the note, so updatedAt (sort order) stays. */
  setTranscript(id: string, text: string, lang: string | null): Note {
    return this.updateTranscript(id, { transcript: text, transcriptLang: lang, transcribedAt: this.now() });
  }

  /** The user correcting the text: language and time of transcription are kept. */
  editTranscript(id: string, text: string): Note {
    return this.updateTranscript(id, { transcript: text });
  }

  private updateTranscript(id: string, patch: Partial<Note>): Note {
    const updated = this.db.update(notes).set(patch).where(eq(notes.id, id)).returning().get();
    if (!updated) throw new Error('Note not found');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const note = this.get(id);
    if (!note) return;
    await fs.promises.rm(this.absolutePath(note), { force: true });
    this.db.delete(notes).where(eq(notes.id, id)).run();
  }

  /** folderId null = Inbox. Unknown note ids are ignored. */
  moveNotes(ids: string[], folderId: string | null): void {
    if (folderId && !this.folders.get(folderId)) throw new Error('Folder not found');
    this.db.update(notes).set({ folderId, updatedAt: this.now() }).where(inArray(notes.id, ids)).run();
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

    const known = new Set<string>();
    for (const note of this.list()) {
      known.add(note.id);
      const exists = fs.existsSync(this.absolutePath(note));
      const status = exists ? 'ok' : 'missing';
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

  absolutePath(note: Note): string {
    return path.join(this.rootDir, note.filePath);
  }

  close(): void {
    this.sqlite.close();
  }
}
