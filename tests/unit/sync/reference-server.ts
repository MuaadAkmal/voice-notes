import { randomUUID } from 'node:crypto';
import type { PullResponse, PushRequest, PushResponse, ServerRow, SyncServer } from '../../../src/main/sync/engine';
import { isDescendant } from '../../../src/shared/folders';
import { applyOp, type FolderRow, type PageRow, type RowOp, type SyncedKey, type SyncOp } from '../../../src/shared/sync-ops';

// The sync server's rules, in memory, for one account. It is the contract piece C's Supabase code
// must match (docs/superpowers/specs/2026-10-26-sync-prep-design.md §5).

type Entity = ServerRow['entity'];
type Stored = { entity: Entity; id: string; version: number; deleted: boolean; data: Record<string, unknown> };
/** What happened to a page body, so a body edit based on an old version can be judged. */
type BodyEvent = { version: number; clientId: string; deviceName: string; op: RowOp };

const PAGE_SIZE = 500;
const key = (entity: Entity, id: string) => `${entity}:${id}`;

export class ReferenceServer implements SyncServer {
  private version = 0;
  private readonly store = new Map<string, Stored>();
  private readonly prefs = new Map<SyncedKey, { value: unknown; version: number }>();
  private readonly seen = new Map<string, number>(); // clientId:mutationId → version acked
  private readonly bodyLog = new Map<string, BodyEvent[]>();
  private dropAck = false;

  /** The next push is applied but answered with an error, as if the connection dropped. */
  dropNextAck(): void {
    this.dropAck = true;
  }

  rows(): ServerRow[] {
    return [...this.store.values()].map(toServerRow);
  }

  row<E extends Entity>(entity: E, id: string): Extract<ServerRow, { entity: E }> | undefined {
    const s = this.store.get(key(entity, id));
    return s && (toServerRow(s) as Extract<ServerRow, { entity: E }>);
  }

  async push(req: PushRequest): Promise<PushResponse> {
    const acked = req.mutations.map((mut) => {
      const seenKey = `${req.clientId}:${mut.id}`;
      const known = this.seen.get(seenKey);
      if (known !== undefined) return { id: mut.id, version: known };
      const version = this.apply(mut.op, mut.baseVersion, req.clientId, req.deviceName);
      this.seen.set(seenKey, version);
      return { id: mut.id, version };
    });
    if (this.dropAck) {
      this.dropAck = false;
      throw new Error('connection lost');
    }
    return { acked };
  }

  async pull(req: { clientId: string; cursor: number }): Promise<PullResponse> {
    type Item = { version: number; row?: ServerRow; pref?: PullResponse['prefs'][number] };
    const items: Item[] = [
      ...[...this.store.values()].filter((s) => s.version > req.cursor).map((s) => ({ version: s.version, row: toServerRow(s) })),
      ...[...this.prefs].filter(([, p]) => p.version > req.cursor).map(([k, p]) => ({ version: p.version, pref: { key: k, ...p } })),
    ].sort((a, b) => a.version - b.version);
    const page = items.slice(0, PAGE_SIZE);
    return {
      cursor: page.length ? page[page.length - 1].version : req.cursor,
      hasMore: items.length > PAGE_SIZE,
      rows: page.flatMap((i) => (i.row ? [i.row] : [])),
      prefs: page.flatMap((i) => (i.pref ? [i.pref] : [])),
    };
  }

  private next(): number {
    return ++this.version;
  }

  /** Applies one change and returns the version to ack it with. */
  private apply(op: SyncOp, baseVersion: number, clientId: string, deviceName: string): number {
    if (op.op === 'prefs.set') {
      const version = this.next();
      this.prefs.set(op.key, { value: op.value, version });
      return version;
    }
    const entity = op.op.split('.')[0] as Entity;
    const current = this.store.get(key(entity, op.id));

    if (op.op.endsWith('.create')) {
      if (current) return current.version; // already here (or deleted: delete wins)
      const data = this.place(entity, op.id, { ...(op as { row: Record<string, unknown> }).row });
      return this.save({ entity, id: op.id, deleted: false, data });
    }
    if (!current || current.deleted) return current?.version ?? 0; // delete wins
    if (op.op.endsWith('.delete')) {
      const version = this.save({ ...current, deleted: true });
      if (entity === 'folder') this.rehome(op.id);
      return version;
    }

    if (op.op === 'page.setBody') return this.setBody(current, op.body, baseVersion, clientId, deviceName);

    let data = applyOp<Record<string, unknown>>(current.data, op) ?? current.data;
    if (op.op === 'folder.update' && 'parentId' in op.fields) {
      const target = this.liveFolder((op.fields.parentId ?? null) as string | null);
      // A move into its own subtree (two PCs moving folders into each other) is refused; the row is re-sent.
      if (target === op.id || (target && isDescendant(this.folders(), op.id, target))) data = { ...data, parentId: current.data.parentId };
      else data = { ...data, parentId: target };
    }
    data = this.place(entity, op.id, data);
    const version = this.save({ ...current, data });
    if (op.op === 'page.append' || op.op === 'page.setTask') this.logBody(op.id, { version, clientId, deviceName, op });
    return version;
  }

  /**
   * The newer push wins. Appends and ticks made meanwhile on another PC are replayed on top of it;
   * another PC's body edit made meanwhile is kept as a conflict copy named after that PC.
   */
  private setBody(current: Stored, body: string, baseVersion: number, clientId: string, deviceName: string): number {
    const since = (this.bodyLog.get(current.id) ?? []).filter((e) => e.version > baseVersion && e.clientId !== clientId);
    const rival = [...since].reverse().find((e) => e.op.op === 'page.setBody');
    const page = current.data as PageRow;
    if (rival && page.body !== body) {
      const copyId = randomUUID();
      this.save({
        entity: 'page',
        id: copyId,
        deleted: false,
        data: { ...page, id: copyId, title: `${page.title} (conflict, ${rival.deviceName})` },
      });
    }
    let next: PageRow = { ...page, body };
    // Without a rival edit, appends and ticks made since are laid back on the incoming text.
    if (!rival) for (const e of since) next = applyOp(next, e.op) as PageRow;
    const version = this.save({ ...current, data: next });
    this.logBody(current.id, { version, clientId, deviceName, op: { op: 'page.setBody', id: current.id, body } });
    return version;
  }

  /** What is still in a deleted folder (put there from another PC) moves up, as a local delete does. */
  private rehome(folderId: string): void {
    for (const s of [...this.store.values()]) {
      if (s.deleted) continue;
      const field = s.entity === 'folder' ? 'parentId' : 'folderId';
      if (s.data[field] !== folderId) continue;
      this.save({ ...s, data: this.place(s.entity, s.id, { ...s.data }) });
    }
  }

  private logBody(pageId: string, e: BodyEvent): void {
    this.bodyLog.set(pageId, [...(this.bodyLog.get(pageId) ?? []), e]);
  }

  private save(s: Omit<Stored, 'version'>): number {
    const version = this.next();
    this.store.set(key(s.entity, s.id), { ...s, version });
    return version;
  }

  private folders(): FolderRow[] {
    return [...this.store.values()].filter((s) => s.entity === 'folder' && !s.deleted).map((s) => s.data as FolderRow);
  }

  /** `id` if it is a live folder, else its nearest live ancestor, else the root. */
  private liveFolder(id: string | null): string | null {
    let at = id;
    while (at) {
      const f = this.store.get(key('folder', at));
      if (!f) return null;
      if (!f.deleted) return at;
      at = (f.data.parentId as string | null) ?? null;
    }
    return null;
  }

  /** Points the row at live folders, and gives a clashing folder name a number. */
  private place(entity: Entity, id: string, data: Record<string, unknown>): Record<string, unknown> {
    if (entity !== 'folder') return { ...data, folderId: this.liveFolder((data.folderId as string | null) ?? null) };
    const parentId = this.liveFolder((data.parentId as string | null) ?? null);
    const taken = (name: string) =>
      this.folders().some((f) => f.id !== id && f.parentId === parentId && f.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    let name = data.name as string;
    for (let n = 2; taken(name); n++) name = `${data.name as string} (${n})`;
    return { ...data, parentId, name };
  }
}

function toServerRow(s: Stored): ServerRow {
  return { entity: s.entity, id: s.id, version: s.version, deleted: s.deleted, data: s.deleted ? null : s.data } as ServerRow;
}
