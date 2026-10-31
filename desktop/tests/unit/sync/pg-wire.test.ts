import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgStore } from '../../../src/shared/sync/pg-store';
import { postgresDb } from '../../../src/shared/sync/postgres-db';
import { SyncCore } from '../../../src/shared/sync/server-core';
import { runContract } from './contract';
import { TEST_USER, TestServer } from './reference-server';

// The production path: postgres.js (as in the Edge Function, prepare: false) speaking the Postgres
// wire protocol to PGlite. PGlite's in-process API forgives things postgres.js does not (it passes a
// pre-serialised JSON string through; postgres.js serialises it again).

const MIGRATION = fs.readFileSync(path.resolve('../supabase/migrations', fs.readdirSync('../supabase/migrations').find((f) => f.endsWith('_sync_rows.sql'))!), 'utf8');
const PORT = 54_000 + Math.floor(Math.random() * 1000);

let pg: PGlite;
let socket: PGLiteSocketServer;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
    create role anon; create role authenticated; insert into auth.users values ('${TEST_USER}');`);
  await pg.exec(MIGRATION);
  socket = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' });
  await socket.start();
  sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { prepare: false, max: 1, onnotice: () => undefined });
}, 60_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await socket?.stop();
  await pg?.close();
});

async function fresh() {
  await sql.unsafe('truncate public.sync_accounts, public.sync_rows, public.sync_prefs, public.sync_seen, public.sync_body_log');
  return new PgStore(postgresDb(sql), Date.now);
}

runContract('server rules through postgres.js', async () => new TestServer(await fresh()), 120_000);

it('rows, settings and the body log are stored as JSON values, not JSON strings', async () => {
  const core = new SyncCore(await fresh());
  const folder = { id: 'f', name: 'Work', parentId: null, createdAt: 1, updatedAt: 1 };
  const page = { id: 'p', title: 'P', body: 'x', folderId: 'f', starred: false, createdAt: 1, updatedAt: 1 };
  await core.push(TEST_USER, {
    clientId: 'A',
    deviceName: 'A',
    mutations: [
      { id: 'm1', op: { op: 'folder.create', id: 'f', row: folder }, baseVersion: 0 },
      { id: 'm2', op: { op: 'page.create', id: 'p', row: page }, baseVersion: 0 },
      { id: 'm3', op: { op: 'page.append', id: 'p', text: 'milk', day: '2026-10-27' }, baseVersion: 0 },
      { id: 'm4', op: { op: 'prefs.set', key: 'transcribeLanguage', value: 'en' }, baseVersion: 0 },
    ],
  });
  const kinds = await sql.unsafe(
    `select jsonb_typeof(data) as row_type, data ->> 'folderId' as folder from public.sync_rows where id = 'p'`,
  );
  expect(kinds[0]).toEqual({ row_type: 'object', folder: 'f' });
  expect((await sql.unsafe(`select jsonb_typeof(op) as t from public.sync_body_log`))[0].t).toBe('object');
  const pulled = await core.pull(TEST_USER, { clientId: 'B', cursor: 0 });
  expect(pulled.prefs).toEqual([expect.objectContaining({ key: 'transcribeLanguage', value: 'en' })]);
  expect(pulled.rows.find((r) => r.id === 'p')!.data).toMatchObject({ title: 'P', folderId: 'f' });
});
