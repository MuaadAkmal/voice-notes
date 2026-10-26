import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq, getTableColumns, isNull } from 'drizzle-orm';
import type { Folder } from '../../shared/channels';
import { isDescendant } from '../../shared/folders';
import type { Outbox } from '../sync/outbox';
import { folders, liveColumns, notes, pages } from './schema';

const folderColumns = liveColumns(getTableColumns(folders));
const live = isNull(folders.deletedAt);

const MAX_NAME = 100;

/** App-only folder tree. Shares NoteStore's connection; audio files never move. */
export class FolderStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly sqlite: Database.Database,
    private readonly now: () => number,
    private readonly outbox: Outbox,
  ) {}

  private recordUpdate(id: string, fields: Partial<Pick<Folder, 'name' | 'parentId' | 'updatedAt'>>): void {
    this.outbox.record({ op: 'folder.update', id, fields }, this.outbox.rowVersion('folder', id));
  }

  list(): Folder[] {
    return this.db.select(folderColumns).from(folders).where(live).all();
  }

  get(id: string): Folder | undefined {
    return this.db.select(folderColumns).from(folders).where(and(eq(folders.id, id), live)).get();
  }

  create(name: string, parentId: string | null): Folder {
    const clean = cleanName(name);
    if (parentId) this.require(parentId);
    this.assertFree(clean, parentId);
    const ts = this.now();
    const folder: Folder = { id: randomUUID(), name: clean, parentId, createdAt: ts, updatedAt: ts };
    this.sqlite.transaction(() => {
      this.db.insert(folders).values(folder).run();
      this.outbox.record({ op: 'folder.create', id: folder.id, row: folder }, 0);
    })();
    return folder;
  }

  rename(id: string, name: string): Folder {
    const folder = this.require(id);
    const clean = cleanName(name);
    this.assertFree(clean, folder.parentId, id);
    return this.sqlite.transaction(() => {
      const folder = this.update(id, { name: clean });
      this.recordUpdate(id, { name: clean, updatedAt: folder.updatedAt });
      return folder;
    })();
  }

  move(id: string, parentId: string | null): Folder {
    const folder = this.require(id);
    if (parentId) {
      this.require(parentId);
      if (isDescendant(this.list(), id, parentId)) throw new Error("Can't move a folder into itself");
    }
    this.assertFree(folder.name, parentId, id);
    return this.sqlite.transaction(() => {
      const moved = this.update(id, { parentId });
      this.recordUpdate(id, { parentId, updatedAt: moved.updatedAt });
      return moved;
    })();
  }

  /** Moves the folder's notes, pages and subfolders up to its parent (renaming clashes "Name (2)"), then deletes it. */
  delete(id: string): void {
    const folder = this.require(id);
    this.sqlite.transaction(() => {
      const folderId = folder.parentId;
      const movedNotes = this.db
        .update(notes)
        .set({ folderId })
        .where(and(eq(notes.folderId, id), isNull(notes.deletedAt)))
        .returning({ id: notes.id })
        .all();
      for (const n of movedNotes) this.outbox.record({ op: 'note.update', id: n.id, fields: { folderId } }, this.outbox.rowVersion('note', n.id));
      const movedPages = this.db
        .update(pages)
        .set({ folderId })
        .where(and(eq(pages.folderId, id), isNull(pages.deletedAt)))
        .returning({ id: pages.id })
        .all();
      for (const p of movedPages) this.outbox.record({ op: 'page.update', id: p.id, fields: { folderId } }, this.outbox.rowVersion('page', p.id));
      for (const child of this.list().filter((f) => f.parentId === id)) {
        const name = this.freeName(child.name, folder.parentId, child.id);
        const moved = this.update(child.id, { parentId: folder.parentId, name });
        this.recordUpdate(child.id, { parentId: folder.parentId, name, updatedAt: moved.updatedAt });
      }
      this.db.update(folders).set({ deletedAt: this.now() }).where(eq(folders.id, id)).run(); // tombstone
      this.outbox.record({ op: 'folder.delete', id }, this.outbox.rowVersion('folder', id));
    })();
  }

  private update(id: string, patch: Partial<Pick<Folder, 'name' | 'parentId'>>): Folder {
    return this.db
      .update(folders)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(folders.id, id))
      .returning(folderColumns)
      .get()!;
  }

  private require(id: string): Folder {
    const folder = this.get(id);
    if (!folder) throw new Error('Folder not found');
    return folder;
  }

  private taken(name: string, parentId: string | null, exceptId?: string): boolean {
    const key = name.toLocaleLowerCase();
    return this.list().some(
      (f) => f.parentId === parentId && f.id !== exceptId && f.name.toLocaleLowerCase() === key,
    );
  }

  private assertFree(name: string, parentId: string | null, exceptId?: string): void {
    if (this.taken(name, parentId, exceptId)) throw new Error(`A folder named "${name}" already exists here`);
  }

  private freeName(name: string, parentId: string | null, exceptId: string): string {
    if (!this.taken(name, parentId, exceptId)) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name} (${n})`;
      if (!this.taken(candidate, parentId, exceptId)) return candidate;
    }
  }
}

function cleanName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > MAX_NAME || /[/\\]/.test(clean)) {
    throw new Error('Folder name is invalid');
  }
  return clean;
}
