import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryConnectorStore } from '../../../src/shared/connectors/memory-store';
import { type ConnectorDb, PgConnectorStore } from '../../../src/shared/connectors/pg-store';
import type { ConnectorRow, ConnectorStore } from '../../../src/shared/connectors/store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const MIGRATION = fs.readFileSync(
  path.resolve('supabase/migrations', fs.readdirSync('supabase/migrations').find((f) => f.endsWith('_connectors.sql'))!),
  'utf8',
);

// One PGlite for the file (a PGlite per test exhausts WASM memory); each test starts from empty tables.
let shared: Promise<PGlite> | null = null;
async function pgStore(): Promise<ConnectorStore> {
  shared ??= (async () => {
    const pg = new PGlite();
    await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
      create role anon; create role authenticated;
      insert into auth.users values ('${A}'), ('${B}');`);
    await pg.exec(MIGRATION);
    return pg;
  })();
  const pg = await shared;
  await pg.exec('truncate public.connectors, public.connector_states');
  const db: ConnectorDb = { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows };
  return new PgConnectorStore(db);
}

afterAll(async () => {
  await (await shared)?.close();
});

const row = (over: Partial<ConnectorRow> = {}): ConnectorRow => ({
  userId: A,
  provider: 'google-calendar',
  accountEmail: 'me@gmail.com',
  refreshToken: 'sealed',
  scopes: 'openid email',
  connectedAt: 1_700_000_000_000,
  ...over,
});

function runStoreContract(name: string, make: () => Promise<ConnectorStore>, timeout = 5_000) {
  describe(name, { timeout }, () => {
    it('a state is taken once', async () => {
      const s = await make();
      await s.putState({ state: 'st', userId: A, provider: 'google-calendar', expiresAt: 2_000_000_000_000 });
      expect(await s.takeState('st', 1_000)).toEqual({ userId: A, provider: 'google-calendar' });
      expect(await s.takeState('st', 1_000)).toBeNull();
    });

    it('an expired state is null', async () => {
      const s = await make();
      await s.putState({ state: 'st', userId: A, provider: 'google-calendar', expiresAt: 100 });
      expect(await s.takeState('st', 101)).toBeNull();
    });

    it('deleteExpiredStates keeps live ones', async () => {
      const s = await make();
      await s.putState({ state: 'old', userId: A, provider: 'google-calendar', expiresAt: 100 });
      await s.putState({ state: 'live', userId: A, provider: 'google-calendar', expiresAt: 10_000 });
      await s.deleteExpiredStates(500);
      expect(await s.takeState('live', 500)).not.toBeNull();
      expect(await s.takeState('old', 50)).toBeNull(); // gone, even asked as if it were still live
    });

    it('put upserts', async () => {
      const s = await make();
      await s.put(row());
      await s.put(row({ accountEmail: 'other@gmail.com' }));
      expect(await s.get(A, 'google-calendar')).toEqual(row({ accountEmail: 'other@gmail.com' }));
    });

    it('rows are per user', async () => {
      const s = await make();
      await s.put(row());
      expect(await s.get(B, 'google-calendar')).toBeNull();
      await s.delete(B, 'google-calendar');
      expect(await s.get(A, 'google-calendar')).not.toBeNull();
      await s.delete(A, 'google-calendar');
      expect(await s.get(A, 'google-calendar')).toBeNull();
    });
  });
}

runStoreContract('memory connector store', async () => new MemoryConnectorStore());
// The first test boots PGlite, slow while the whole suite runs alongside it.
runStoreContract('Postgres connector store', pgStore, 60_000);

it('the migration keeps the tables away from client roles', () => {
  expect(MIGRATION).toMatch(/alter table public\.connectors enable row level security/);
  expect(MIGRATION).toMatch(/revoke all on public\.connectors, public\.connector_states from anon, authenticated/);
});
