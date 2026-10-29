import { isDescendant } from '../folders';
import { applyOp, type FolderRow, type PageRow, type RowOp, type SyncedKey, type SyncOp } from '../sync-ops';
import { type FileKind, PULL_PAGE_SIZE, type PullRequest, type PullResponse, type PushRequest, type PushResponse } from './protocol';

// The sync server's rules for one account at a time, independent of where rows are kept: in memory
// for the tests, in Postgres inside the Edge Function. Pure TypeScript (runs in Node and Deno).

export type Entity = 'note' | 'page' | 'folder';
export type StoredRow = { entity: Entity; id: string; version: number; deleted: boolean; data: Record<string, unknown> };
/** What happened to a page body, so a body edit based on an old version can be judged. */
export type BodyEvent = { version: number; clientId: string; deviceName: string; op: RowOp };

/** One push's view of one account, inside a transaction that holds the account's lock. */
export interface SyncTx {
  nextVersion(): Promise<number>;
  /** Body history at or below this version was purged (30 days): older bases can't be judged. */
  logFloor(): Promise<number>;
  getRow(entity: Entity, id: string): Promise<StoredRow | undefined>;
  putRow(row: StoredRow): Promise<void>;
  liveFolders(): Promise<FolderRow[]>;
  /** Live notes, pages and folders whose folderId / parentId is `folderId`. */
  rowsInFolder(folderId: string): Promise<StoredRow[]>;
  seen(clientId: string, mutationId: string): Promise<number | undefined>;
  markSeen(clientId: string, mutationId: string, version: number): Promise<void>;
  bodyLog(pageId: string, sinceVersion: number): Promise<BodyEvent[]>;
  logBody(pageId: string, e: BodyEvent): Promise<void>;
  setPref(key: SyncedKey, value: unknown, version: number): Promise<void>;
}

export interface SyncStore {
  transaction<T>(userId: string, fn: (tx: SyncTx) => Promise<T>): Promise<T>;
  pullSince(userId: string, cursor: number, limit: number): Promise<PullResponse>;
  /** Audio: its note row. Image: 'live' while a live page body references it (never 'deleted'). */
  fileOwner(userId: string, kind: FileKind, name: string): Promise<'live' | 'deleted' | 'none'>;
  /** Live notes' audio file names and the images live pages reference. */
  liveFiles(userId: string): Promise<{ audio: Set<string>; images: Set<string> }>;
}

export class SyncCore {
  constructor(
    private readonly store: SyncStore,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  push(userId: string, req: PushRequest): Promise<PushResponse> {
    return this.store.transaction(userId, async (tx) => {
      const acked: PushResponse['acked'] = [];
      for (const mut of req.mutations) {
        const known = await tx.seen(req.clientId, mut.id);
        if (known !== undefined) {
          acked.push({ id: mut.id, version: known });
          continue;
        }
        const version = await this.apply(tx, mut.op, mut.baseVersion, req.clientId, req.deviceName);
        await tx.markSeen(req.clientId, mut.id, version);
        acked.push({ id: mut.id, version });
      }
      return { acked };
    });
  }

  pull(userId: string, req: PullRequest): Promise<PullResponse> {
    return this.store.pullSince(userId, req.cursor, PULL_PAGE_SIZE);
  }

  /** Applies one change and returns the version to ack it with. */
  private async apply(tx: SyncTx, op: SyncOp, baseVersion: number, clientId: string, deviceName: string): Promise<number> {
    if (op.op === 'prefs.set') {
      const version = await tx.nextVersion();
      await tx.setPref(op.key, op.value, version);
      return version;
    }
    const entity = op.op.split('.')[0] as Entity;
    const current = await tx.getRow(entity, op.id);

    if (op.op.endsWith('.create')) {
      if (current) return current.version; // already here (or deleted: delete wins)
      const data = await this.place(tx, entity, op.id, { ...(op as { row: Record<string, unknown> }).row });
      return this.save(tx, { entity, id: op.id, deleted: false, data });
    }
    if (!current || current.deleted) return current?.version ?? 0; // delete wins
    if (op.op.endsWith('.delete')) {
      const version = await this.save(tx, { ...current, deleted: true });
      if (entity === 'folder') await this.rehome(tx, op.id);
      return version;
    }

    if (op.op === 'page.setBody') return this.setBody(tx, current, op.body, op.at, baseVersion, clientId, deviceName);

    let data = applyOp<Record<string, unknown>>(current.data, op) ?? current.data;
    if (op.op === 'folder.update' && 'parentId' in op.fields) {
      const target = await this.liveFolder(tx, (op.fields.parentId ?? null) as string | null);
      // A move into its own subtree (two PCs moving folders into each other) is refused; the row is re-sent.
      if (target === op.id || (target && isDescendant(await tx.liveFolders(), op.id, target)))
        data = { ...data, parentId: current.data.parentId };
      else data = { ...data, parentId: target };
    }
    data = await this.place(tx, entity, op.id, data);
    const version = await this.save(tx, { ...current, data });
    if (op.op === 'page.append' || op.op === 'page.setTask') await tx.logBody(op.id, { version, clientId, deviceName, op });
    return version;
  }

  /**
   * The newer push wins. Appends and ticks made meanwhile on another PC are replayed on top of it;
   * another PC's body edit made meanwhile is kept as a conflict copy named after that PC.
   */
  private async setBody(
    tx: SyncTx,
    current: StoredRow,
    body: string,
    at: number | undefined,
    baseVersion: number,
    clientId: string,
    deviceName: string,
  ): Promise<number> {
    const since = (await tx.bodyLog(current.id, baseVersion)).filter((e) => e.clientId !== clientId);
    let rival: { deviceName: string } | undefined = [...since].reverse().find((e) => e.op.op === 'page.setBody');
    // Based on history the server no longer has, on a page that changed since: assume a rival edit.
    if (!rival && baseVersion < (await tx.logFloor()) && current.version > baseVersion) rival = { deviceName: 'another PC' };
    const page = current.data as PageRow;
    if (rival && page.body !== body) {
      const copyId = this.newId();
      await this.save(tx, {
        entity: 'page',
        id: copyId,
        deleted: false,
        data: { ...page, id: copyId, title: `${page.title} (conflict, ${rival.deviceName})` },
      });
    }
    const op: RowOp = { op: 'page.setBody', id: current.id, body, ...(at === undefined ? {} : { at }) };
    let next = applyOp(page, op) as PageRow;
    // Without a rival edit, appends and ticks made since are laid back on the incoming text.
    if (!rival) for (const e of since) next = applyOp(next, e.op) as PageRow;
    const version = await this.save(tx, { ...current, data: next });
    await tx.logBody(current.id, { version, clientId, deviceName, op });
    return version;
  }

  /** What is still in a deleted folder (put there from another PC) moves up, as a local delete does. */
  private async rehome(tx: SyncTx, folderId: string): Promise<void> {
    for (const row of await tx.rowsInFolder(folderId)) {
      await this.save(tx, { ...row, data: await this.place(tx, row.entity, row.id, { ...row.data }) });
    }
  }

  private async save(tx: SyncTx, row: Omit<StoredRow, 'version'>): Promise<number> {
    const version = await tx.nextVersion();
    await tx.putRow({ ...row, version });
    return version;
  }

  /** `id` if it is a live folder, else its nearest live ancestor, else the root. */
  private async liveFolder(tx: SyncTx, id: string | null): Promise<string | null> {
    let at = id;
    for (let hops = 0; at && hops < 1000; hops++) {
      const f = await tx.getRow('folder', at);
      if (!f) return null;
      if (!f.deleted) return at;
      at = (f.data.parentId as string | null) ?? null;
    }
    return null;
  }

  /** Points the row at live folders, and gives a clashing folder name a number. */
  private async place(tx: SyncTx, entity: Entity, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (entity !== 'folder') return { ...data, folderId: await this.liveFolder(tx, (data.folderId as string | null) ?? null) };
    const parentId = await this.liveFolder(tx, (data.parentId as string | null) ?? null);
    const siblings = (await tx.liveFolders()).filter((f) => f.id !== id && f.parentId === parentId).map((f) => f.name.toLocaleLowerCase());
    let name = data.name as string;
    for (let n = 2; siblings.includes(name.toLocaleLowerCase()); n++) name = `${data.name as string} (${n})`;
    return { ...data, parentId, name };
  }
}
