import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, expect, it } from 'vitest';
import { type Db, PgStore } from '../../../src/shared/sync/pg-store';
import { SyncCore } from '../../../src/shared/sync/server-core';
import { runContract } from './contract';
import { TEST_USER, TestServer } from './reference-server';

const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const MIGRATION = fs.readFileSync(path.resolve('supabase/migrations/20261027000000_sync_rows.sql'), 'utf8');

// One Postgres (PGlite) for the whole file, with Supabase's auth.users stand-in and the sync migration
// applied once; each test starts from empty sync tables. (Starting a PGlite per test exhausts WASM memory.)
let shared: Promise<PGlite> | null = null;

async function freshDb(): Promise<{ pg: PGlite; db: Db }> {
  shared ??= (async () => {
    const pg = new PGlite();
    await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
      create role anon; create role authenticated;
      insert into auth.users values ('${TEST_USER}'), ('${OTHER_USER}');`);
    await pg.exec(MIGRATION);
    return pg;
  })();
  const pg = await shared;
  await pg.exec('truncate public.sync_accounts, public.sync_rows, public.sync_prefs, public.sync_seen, public.sync_body_log');
  return { pg, db: asDb(pg) };
}

afterAll(async () => {
  await (await shared)?.close();
});

function asDb(q: Pick<PGlite, 'query'> & Partial<Pick<PGlite, 'transaction'>>): Db {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await q.query<T>(sql, params)).rows,
    transaction: (fn) => (q.transaction ? q.transaction((tx) => fn(asDb(tx))) : fn(asDb(q))),
  };
}

runContract(
  'server rules on Postgres',
  async () => {
    const { db } = await freshDb();
    return new TestServer(new PgStore(db, Date.now));
  },
  60_000, // the paging case makes 600 pushes against an in-process Postgres
);

it('two pushes at once for one account get distinct versions', async () => {
  const { db } = await freshDb();
  const core = new SyncCore(new PgStore(db, Date.now));
  const push = (client: string) =>
    core.push(TEST_USER, {
      clientId: client,
      deviceName: client,
      mutations: Array.from({ length: 5 }, (_, i) => ({
        id: `${client}${i}`,
        op: { op: 'prefs.set' as const, key: 'transcribeLanguage' as const, value: `${client}${i}` },
        baseVersion: 0,
      })),
    });
  const [a, b] = await Promise.all([push('A'), push('B')]);
  const versions = [...a.acked, ...b.acked].map((x) => x.version).sort((x, y) => x - y);
  expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

it('one account never sees another account\'s rows', async () => {
  const { db } = await freshDb();
  const store = new PgStore(db, Date.now);
  const core = new SyncCore(store);
  await core.push(TEST_USER, {
    clientId: 'A',
    deviceName: 'A',
    mutations: [{ id: 'm1', op: { op: 'folder.create', id: 'f', row: { id: 'f', name: 'Mine', parentId: null, createdAt: 1, updatedAt: 1 } }, baseVersion: 0 }],
  });
  const theirs = await core.pull(OTHER_USER, { clientId: 'X', cursor: 0 });
  expect(theirs.rows).toEqual([]);
  // A push from the other account to the same id makes its own row, untouched by ours.
  await core.push(OTHER_USER, { clientId: 'X', deviceName: 'X', mutations: [{ id: 'm1', op: { op: 'folder.delete', id: 'f' }, baseVersion: 0 }] });
  expect((await store.rows(TEST_USER)).map((r) => r.deleted)).toEqual([false]);
});

it('housekeeping forgets mutation ids and body history after 30 days', async () => {
  const { db } = await freshDb();
  let clock = Date.UTC(2026, 0, 1);
  const core = new SyncCore(new PgStore(db, () => clock));
  const page = { id: 'p', title: 'P', body: '', folderId: null, starred: false, createdAt: 1, updatedAt: 1 };
  await core.push(TEST_USER, {
    clientId: 'A',
    deviceName: 'A',
    mutations: [
      { id: 'm1', op: { op: 'page.create', id: 'p', row: page }, baseVersion: 0 },
      { id: 'm2', op: { op: 'page.setBody', id: 'p', body: 'x' }, baseVersion: 0 },
    ],
  });
  clock += 31 * 86_400_000;
  await core.push(TEST_USER, { clientId: 'A', deviceName: 'A', mutations: [] });
  const count = async (t: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`))[0].n);
  expect(await count('sync_seen')).toBe(0);
  expect(await count('sync_body_log')).toBe(0);
});

it('every sync table has row-level security on and no client access', async () => {
  const { db } = await freshDb();
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname, relrowsecurity from pg_class where relname like 'sync\\_%' and relkind = 'r' order by relname",
  );
  expect(rls.map((r) => r.relname)).toEqual(['sync_accounts', 'sync_body_log', 'sync_prefs', 'sync_rows', 'sync_seen']);
  expect(rls.every((r) => r.relrowsecurity)).toBe(true);
  const grants = await db.query(
    "select 1 from information_schema.role_table_grants where table_name like 'sync\\_%' and grantee in ('anon', 'authenticated')",
  );
  expect(grants).toEqual([]);
});
