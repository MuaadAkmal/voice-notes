import type { FolderRow, SyncedKey } from '../sync-ops.ts';
import { imageRefs } from '../page-images.ts';
import type { FileKind, PullResponse, ServerRow } from './protocol.ts';
import type { BodyEvent, Entity, StoredRow, SyncStore, SyncTx } from './server-core.ts';

// SyncStore on the Postgres tables of supabase/migrations/*_sync_rows.sql. Every statement is
// scoped by user_id; a push holds its account row's lock, so one account's pushes run in turn.

/** The database port: postgres.js in the Edge Function, PGlite in the tests. */
export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
};

const KEEP_MS = 30 * 86_400_000;
const HOUSEKEEP_EVERY_MS = 3_600_000;

type RowRecord = { entity: Entity; id: string; version: number | string; deleted: boolean; data: Record<string, unknown> };

const toStored = (r: RowRecord): StoredRow => ({
  entity: r.entity,
  id: r.id,
  version: Number(r.version),
  deleted: r.deleted,
  data: r.data,
});

export class PgStore implements SyncStore {
  private readonly lastHousekeep = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** For tests and checks: every row of one account. */
  async rows(userId: string): Promise<StoredRow[]> {
    const rows = await this.db.query<RowRecord>(
      'select entity, id, version, deleted, data from public.sync_rows where user_id = $1 order by version',
      [userId],
    );
    return rows.map(toStored);
  }

  transaction<T>(userId: string, fn: (tx: SyncTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (q) => {
      await q.query('insert into public.sync_accounts (user_id) values ($1) on conflict (user_id) do nothing', [userId]);
      await this.housekeep(q, userId);
      const [account] = await q.query<{ version: number | string; log_floor: number | string }>(
        'select version, log_floor from public.sync_accounts where user_id = $1 for update',
        [userId],
      );
      let version = Number(account.version);
      const logFloor = Number(account.log_floor);
      const at = () => this.now() / 1000;
      const tx: SyncTx = {
        logFloor: async () => logFloor,
        nextVersion: async () => {
          version += 1;
          await q.query('update public.sync_accounts set version = $2 where user_id = $1', [userId, version]);
          return version;
        },
        getRow: async (entity, id) => {
          const [r] = await q.query<RowRecord>(
            'select entity, id, version, deleted, data from public.sync_rows where user_id = $1 and entity = $2 and id = $3',
            [userId, entity, id],
          );
          return r && toStored(r);
        },
        putRow: async (row) => {
          await q.query(
            `insert into public.sync_rows (user_id, entity, id, version, deleted, data) values ($1, $2, $3, $4, $5, $6::text::jsonb)
             on conflict (user_id, entity, id) do update set version = excluded.version, deleted = excluded.deleted, data = excluded.data`,
            [userId, row.entity, row.id, row.version, row.deleted, JSON.stringify(row.data)],
          );
        },
        liveFolders: async () =>
          (
            await q.query<{ data: FolderRow }>(
              "select data from public.sync_rows where user_id = $1 and entity = 'folder' and not deleted",
              [userId],
            )
          ).map((r) => r.data),
        rowsInFolder: async (folderId) =>
          (
            await q.query<RowRecord>(
              `select entity, id, version, deleted, data from public.sync_rows
               where user_id = $1 and not deleted
                 and ((entity = 'folder' and data ->> 'parentId' = $2) or (entity <> 'folder' and data ->> 'folderId' = $2))`,
              [userId, folderId],
            )
          ).map(toStored),
        seen: async (clientId, mutationId) => {
          const [r] = await q.query<{ version: number | string }>(
            'select version from public.sync_seen where user_id = $1 and client_id = $2 and mutation_id = $3',
            [userId, clientId, mutationId],
          );
          return r && Number(r.version);
        },
        markSeen: async (clientId, mutationId, v) => {
          await q.query(
            'insert into public.sync_seen (user_id, client_id, mutation_id, version, created_at) values ($1, $2, $3, $4, to_timestamp($5))',
            [userId, clientId, mutationId, v, at()],
          );
        },
        bodyLog: async (pageId, since) =>
          (
            await q.query<{ version: number | string; client_id: string; device_name: string; op: BodyEvent['op'] }>(
              `select version, client_id, device_name, op from public.sync_body_log
               where user_id = $1 and page_id = $2 and version > $3 order by version`,
              [userId, pageId, since],
            )
          ).map((r) => ({ version: Number(r.version), clientId: r.client_id, deviceName: r.device_name, op: r.op })),
        logBody: async (pageId, e) => {
          await q.query(
            `insert into public.sync_body_log (user_id, page_id, version, client_id, device_name, op, created_at)
             values ($1, $2, $3, $4, $5, $6::text::jsonb, to_timestamp($7))`,
            [userId, pageId, e.version, e.clientId, e.deviceName, JSON.stringify(e.op), at()],
          );
        },
        setPref: async (key: SyncedKey, value, v) => {
          await q.query(
            `insert into public.sync_prefs (user_id, key, value, version) values ($1, $2, $3::text::jsonb, $4)
             on conflict (user_id, key) do update set value = excluded.value, version = excluded.version`,
            [userId, key, JSON.stringify(value ?? null), v],
          );
        },
      };
      return fn(tx);
    });
  }

  async pullSince(userId: string, cursor: number, limit: number): Promise<PullResponse> {
    type Item = { kind: 'row' | 'pref'; entity: Entity | null; id: string | null; version: number | string; deleted: boolean | null; data: Record<string, unknown> | null; key: SyncedKey | null; value: unknown };
    const items = await this.db.query<Item>(
      `select * from (
         select 'row' as kind, entity, id, version, deleted, case when deleted then null else data end as data,
                null::text as key, null::jsonb as value
           from public.sync_rows where user_id = $1 and version > $2
         union all
         select 'pref', null, null, version, null, null, key, value
           from public.sync_prefs where user_id = $1 and version > $2
       ) t order by version limit $3`,
      [userId, cursor, limit + 1],
    );
    const page = items.slice(0, limit);
    return {
      cursor: page.length ? Number(page[page.length - 1].version) : cursor,
      hasMore: items.length > limit,
      rows: page
        .filter((i) => i.kind === 'row')
        .map((i) => ({ entity: i.entity, id: i.id, version: Number(i.version), deleted: !!i.deleted, data: i.data }) as ServerRow),
      prefs: page.filter((i) => i.kind === 'pref').map((i) => ({ key: i.key as SyncedKey, value: i.value, version: Number(i.version) })),
    };
  }

  async fileOwner(userId: string, kind: FileKind, name: string): Promise<'live' | 'deleted' | 'none'> {
    if (kind === 'audio') {
      const [r] = await this.db.query<{ deleted: boolean }>(
        "select deleted from public.sync_rows where user_id = $1 and entity = 'note' and id = $2",
        [userId, name.replace(/\.webm$/, '')],
      );
      return r ? (r.deleted ? 'deleted' : 'live') : 'none';
    }
    const [r] = await this.db.query(
      "select 1 from public.sync_rows where user_id = $1 and entity = 'page' and not deleted and strpos(data ->> 'body', $2) > 0 limit 1",
      [userId, `vn-image://${name}`],
    );
    return r ? 'live' : 'none';
  }

  async liveFiles(userId: string): Promise<{ audio: Set<string>; images: Set<string> }> {
    const rows = await this.db.query<{ entity: Entity; id: string; body: string | null }>(
      "select entity, id, data ->> 'body' as body from public.sync_rows where user_id = $1 and not deleted and entity in ('note', 'page')",
      [userId],
    );
    return {
      audio: new Set(rows.filter((r) => r.entity === 'note').map((r) => `${r.id}.webm`)),
      images: new Set(rows.filter((r) => r.entity === 'page').flatMap((r) => [...imageRefs(r.body ?? '')])),
    };
  }

  /** Mutation ids and body history only matter for retries and recent edits: keep 30 days, per account, at most hourly. */
  private async housekeep(q: Db, userId: string): Promise<void> {
    const now = this.now();
    if (now - (this.lastHousekeep.get(userId) ?? -Infinity) < HOUSEKEEP_EVERY_MS) return;
    this.lastHousekeep.set(userId, now);
    const cutoff = (now - KEEP_MS) / 1000;
    await q.query('delete from public.sync_seen where user_id = $1 and created_at < to_timestamp($2)', [userId, cutoff]);
    // Remember how far history was purged, so a body edit based on older history is treated as a conflict.
    await q.query(
      `with gone as (delete from public.sync_body_log where user_id = $1 and created_at < to_timestamp($2) returning version)
       update public.sync_accounts set log_floor = greatest(log_floor, coalesce((select max(version) from gone), 0))
       where user_id = $1`,
      [userId, cutoff],
    );
  }
}
