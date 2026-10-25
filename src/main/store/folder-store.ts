import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { Folder } from '../../shared/channels';
import { isDescendant } from '../../shared/folders';
import { folders, notes, pages } from './schema';

const MAX_NAME = 100;

/** App-only folder tree. Shares NoteStore's connection; audio files never move. */
export class FolderStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly sqlite: Database.Database,
    private readonly now: () => number,
  ) {}

  list(): Folder[] {
    return this.db.select().from(folders).all();
  }

  get(id: string): Folder | undefined {
    return this.db.select().from(folders).where(eq(folders.id, id)).get();
  }

  create(name: string, parentId: string | null): Folder {
    const clean = cleanName(name);
    if (parentId) this.require(parentId);
    this.assertFree(clean, parentId);
    const ts = this.now();
    const folder: Folder = { id: randomUUID(), name: clean, parentId, createdAt: ts, updatedAt: ts };
    this.db.insert(folders).values(folder).run();
    return folder;
  }

  rename(id: string, name: string): Folder {
    const folder = this.require(id);
    const clean = cleanName(name);
    this.assertFree(clean, folder.parentId, id);
    return this.update(id, { name: clean });
  }

  move(id: string, parentId: string | null): Folder {
    const folder = this.require(id);
    if (parentId) {
      this.require(parentId);
      if (isDescendant(this.list(), id, parentId)) throw new Error("Can't move a folder into itself");
    }
    this.assertFree(folder.name, parentId, id);
    return this.update(id, { parentId });
  }

  /** Moves the folder's notes, pages and subfolders up to its parent (renaming clashes "Name (2)"), then deletes it. */
  delete(id: string): void {
    const folder = this.require(id);
    this.sqlite.transaction(() => {
      this.db.update(notes).set({ folderId: folder.parentId }).where(eq(notes.folderId, id)).run();
      this.db.update(pages).set({ folderId: folder.parentId }).where(eq(pages.folderId, id)).run();
      for (const child of this.list().filter((f) => f.parentId === id)) {
        const name = this.freeName(child.name, folder.parentId, child.id);
        this.update(child.id, { parentId: folder.parentId, name });
      }
      this.db.delete(folders).where(eq(folders.id, id)).run();
    })();
  }

  private update(id: string, patch: Partial<Pick<Folder, 'name' | 'parentId'>>): Folder {
    return this.db
      .update(folders)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(folders.id, id))
      .returning()
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
