import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Page } from '../../shared/channels';
import { appendEntry } from '../../shared/learn-log';
import { setTaskChecked } from '../../shared/task-lines';
import {
  MAX_IMAGE_BYTES,
  imageRefs,
  type ImageExt,
} from '../../shared/page-images';
import type { FolderStore } from './folder-store';
import type { Outbox } from '../sync/outbox';
import { localDay, type SyncOp, taskText } from '../../shared/sync-ops';
import { pages } from './schema';

// syncedAt, version and deletedAt exist in SQL for sync but are not part of Page.
const live = isNull(pages.deletedAt);
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
    private readonly outbox: Outbox,
  ) {}

  private record(op: Extract<SyncOp, { op: `page.${string}` }>): void {
    this.outbox.record(op, this.outbox.rowVersion('page', op.id));
  }

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
    this.sqlite.transaction(() => {
      this.db.insert(pages).values(page).run();
      this.outbox.record({ op: 'page.create', id: page.id, row: page }, 0);
    })();
    return page;
  }

  list(): Page[] {
    return this.db
      .select(columns)
      .from(pages)
      .where(live)
      .orderBy(desc(pages.updatedAt))
      .all();
  }

  get(id: string): Page | undefined {
    return this.db.select(columns).from(pages).where(and(eq(pages.id, id), live)).get();
  }

  rename(id: string, title: string): Page {
    return this.sqlite.transaction(() => {
      const page = this.update(id, { title });
      this.record({ op: 'page.update', id, fields: { title, updatedAt: page.updatedAt } });
      return page;
    })();
  }

  setBody(id: string, body: string): Page {
    return this.sqlite.transaction(() => {
      const page = this.update(id, { body });
      this.record({ op: 'page.setBody', id, body, at: page.updatedAt });
      return page;
    })();
  }

  /** Adds `text` as a bullet under today's heading (see shared/learn-log), atomically. */
  appendEntry(id: string, text: string): Page {
    return this.sqlite.transaction(() => {
      const page = this.get(id);
      if (!page) throw new Error('Page not found');
      const now = this.now();
      const updated = this.update(id, { body: appendEntry(page.body, text, new Date(now)) });
      // Sent as an append, not a new body: an edit made meanwhile on another PC keeps it.
      this.record({ op: 'page.append', id, text, day: localDay(now), at: updated.updatedAt });
      return updated;
    })();
  }

  /** Ticks or unticks the task on 0-based line `line` of the current body, atomically. */
  setTask(id: string, line: number, checked: boolean): Page {
    return this.sqlite.transaction(() => {
      const page = this.get(id);
      if (!page) throw new Error('Page not found');
      const body = setTaskChecked(page.body, line, checked);
      if (body === null) throw new Error('Not a task');
      const updated = this.update(id, { body });
      const lineText = taskText(page.body.split('\n')[line]);
      this.record({ op: 'page.setTask', id, line, lineText, checked, at: updated.updatedAt });
      return updated;
    })();
  }

  /** folderId null = Inbox. Unknown page ids are ignored. Like starring, it leaves updatedAt (the sort time) alone. */
  move(ids: string[], folderId: string | null): void {
    if (folderId && !this.folders.get(folderId))
      throw new Error('Folder not found');
    this.sqlite.transaction(() => {
      const changed = this.db
        .update(pages)
        .set({ folderId })
        .where(and(inArray(pages.id, ids), live))
        .returning({ id: pages.id })
        .all();
      for (const { id } of changed) this.record({ op: 'page.update', id, fields: { folderId } });
    })();
  }

  /** Unknown page ids are ignored. */
  setStarred(ids: string[], starred: boolean): void {
    this.sqlite.transaction(() => {
      const changed = this.db
        .update(pages)
        .set({ starred })
        .where(and(inArray(pages.id, ids), live))
        .returning({ id: pages.id })
        .all();
      for (const { id } of changed) this.record({ op: 'page.update', id, fields: { starred } });
    })();
  }

  /** Deletes the rows, then the image files no remaining page references. */
  async deleteMany(ids: string[]): Promise<void> {
    const doomed = new Set<string>();
    this.sqlite.transaction(() => {
      for (const id of ids) {
        const page = this.get(id);
        if (!page) continue;
        for (const file of imageRefs(page.body)) doomed.add(file);
        this.db.update(pages).set({ deletedAt: this.now() }).where(eq(pages.id, id)).run(); // tombstone
        this.record({ op: 'page.delete', id });
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
      .where(and(eq(pages.id, id), live))
      .returning(columns)
      .get();
    if (!updated) throw new Error('Page not found');
    return updated;
  }
}
