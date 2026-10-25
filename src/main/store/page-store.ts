import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Page } from '../../shared/channels';
import {
  MAX_IMAGE_BYTES,
  imageRefs,
  type ImageExt,
} from '../../shared/page-images';
import type { FolderStore } from './folder-store';
import { pages } from './schema';

// syncedAt exists in SQL for future sync but is not part of Page.
const columns = {
  id: pages.id,
  title: pages.title,
  body: pages.body,
  folderId: pages.folderId,
  starred: pages.starred,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
};

/** Markdown text notes. Shares NoteStore's connection; images live as files in imagesDir. */
export class PageStore {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly sqlite: Database.Database,
    private readonly now: () => number,
    private readonly folders: FolderStore,
    private readonly imagesDir: string,
  ) {}

  create(folderId: string | null): Page {
    if (folderId && !this.folders.get(folderId))
      throw new Error('Folder not found');
    const ts = this.now();
    const page: Page = {
      id: randomUUID(),
      title: 'Untitled',
      body: '',
      folderId,
      starred: false,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db.insert(pages).values(page).run();
    return page;
  }

  list(): Page[] {
    return this.db
      .select(columns)
      .from(pages)
      .orderBy(desc(pages.updatedAt))
      .all();
  }

  get(id: string): Page | undefined {
    return this.db.select(columns).from(pages).where(eq(pages.id, id)).get();
  }

  rename(id: string, title: string): Page {
    return this.update(id, { title });
  }

  setBody(id: string, body: string): Page {
    return this.update(id, { body });
  }

  /** folderId null = Inbox. Unknown page ids are ignored. Like starring, it leaves updatedAt (the sort time) alone. */
  move(ids: string[], folderId: string | null): void {
    if (folderId && !this.folders.get(folderId))
      throw new Error('Folder not found');
    this.db
      .update(pages)
      .set({ folderId })
      .where(inArray(pages.id, ids))
      .run();
  }

  /** Unknown page ids are ignored. */
  setStarred(ids: string[], starred: boolean): void {
    this.db
      .update(pages)
      .set({ starred })
      .where(inArray(pages.id, ids))
      .run();
  }

  /** Deletes the rows, then the image files no remaining page references. */
  async deleteMany(ids: string[]): Promise<void> {
    const doomed = new Set<string>();
    this.sqlite.transaction(() => {
      for (const id of ids) {
        const page = this.get(id);
        if (!page) continue;
        for (const file of imageRefs(page.body)) doomed.add(file);
        this.db.delete(pages).where(eq(pages.id, id)).run();
      }
    })();
    if (!doomed.size) return;
    for (const page of this.list())
      for (const file of imageRefs(page.body)) doomed.delete(file);
    for (const file of doomed)
      await fs.promises.rm(this.imagePath(file), { force: true });
  }

  /** Writes <uuid>.<ext> via tmp + fsync + rename and returns its vn-image:// url. */
  async saveImage(bytes: Uint8Array, ext: ImageExt): Promise<string> {
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image too large');
    const file = `${randomUUID()}.${ext}`;
    const finalPath = this.imagePath(file);
    const tmpPath = `${finalPath}.tmp`;
    const fh = await fs.promises.open(tmpPath, 'w');
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.promises.rename(tmpPath, finalPath);
    return `vn-image://${file}`;
  }

  imagePath(file: string): string {
    return path.join(this.imagesDir, file);
  }

  private update(
    id: string,
    patch: Partial<Pick<Page, 'title' | 'body'>>,
  ): Page {
    const updated = this.db
      .update(pages)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(pages.id, id))
      .returning(columns)
      .get();
    if (!updated) throw new Error('Page not found');
    return updated;
  }
}
