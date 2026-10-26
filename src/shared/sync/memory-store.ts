import type { FolderRow, SyncedKey } from '../sync-ops';
import type { PullResponse, ServerRow } from './protocol';
import type { BodyEvent, Entity, StoredRow, SyncStore, SyncTx } from './server-core';

type Account = {
  version: number;
  rows: Map<string, StoredRow>;
  prefs: Map<SyncedKey, { value: unknown; version: number }>;
  seen: Map<string, number>;
  bodyLog: Map<string, BodyEvent[]>;
  lock: Promise<unknown>;
};

const key = (entity: Entity, id: string) => `${entity}:${id}`;

export function toServerRow(s: StoredRow): ServerRow {
  return { entity: s.entity, id: s.id, version: s.version, deleted: s.deleted, data: s.deleted ? null : s.data } as ServerRow;
}

/** SyncStore in memory, per account; pushes for one account run one after another, like the Postgres lock. */
export class MemoryStore implements SyncStore {
  private readonly accounts = new Map<string, Account>();

  private account(userId: string): Account {
    let a = this.accounts.get(userId);
    if (!a) {
      a = { version: 0, rows: new Map(), prefs: new Map(), seen: new Map(), bodyLog: new Map(), lock: Promise.resolve() };
      this.accounts.set(userId, a);
    }
    return a;
  }

  rows(userId: string): StoredRow[] {
    return [...this.account(userId).rows.values()];
  }

  async transaction<T>(userId: string, fn: (tx: SyncTx) => Promise<T>): Promise<T> {
    const a = this.account(userId);
    const run = a.lock.then(() => fn(this.tx(a)));
    a.lock = run.catch(() => undefined);
    return run;
  }

  async pullSince(userId: string, cursor: number, limit: number): Promise<PullResponse> {
    const a = this.account(userId);
    type Item = { version: number; row?: ServerRow; pref?: PullResponse['prefs'][number] };
    const items: Item[] = [
      ...[...a.rows.values()].filter((s) => s.version > cursor).map((s) => ({ version: s.version, row: toServerRow(s) })),
      ...[...a.prefs].filter(([, p]) => p.version > cursor).map(([k, p]) => ({ version: p.version, pref: { key: k, ...p } })),
    ].sort((x, y) => x.version - y.version);
    const page = items.slice(0, limit);
    return {
      cursor: page.length ? page[page.length - 1].version : cursor,
      hasMore: items.length > limit,
      rows: page.flatMap((i) => (i.row ? [i.row] : [])),
      prefs: page.flatMap((i) => (i.pref ? [i.pref] : [])),
    };
  }

  private tx(a: Account): SyncTx {
    return {
      nextVersion: async () => ++a.version,
      logFloor: async () => 0, // memory keeps all history
      getRow: async (entity, id) => a.rows.get(key(entity, id)),
      putRow: async (row) => void a.rows.set(key(row.entity, row.id), row),
      liveFolders: async () =>
        [...a.rows.values()].filter((s) => s.entity === 'folder' && !s.deleted).map((s) => s.data as FolderRow),
      rowsInFolder: async (folderId) =>
        [...a.rows.values()].filter(
          (s) => !s.deleted && s.data[s.entity === 'folder' ? 'parentId' : 'folderId'] === folderId,
        ),
      seen: async (clientId, mutationId) => a.seen.get(`${clientId}:${mutationId}`),
      markSeen: async (clientId, mutationId, version) => void a.seen.set(`${clientId}:${mutationId}`, version),
      bodyLog: async (pageId, since) => (a.bodyLog.get(pageId) ?? []).filter((e) => e.version > since),
      logBody: async (pageId, e) => void a.bodyLog.set(pageId, [...(a.bodyLog.get(pageId) ?? []), e]),
      setPref: async (k, value, version) => void a.prefs.set(k, { value, version }),
    };
  }
}
