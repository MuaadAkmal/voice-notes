import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgUsageStore, RestUsageStore } from '../../../src/shared/commands/pg-store';
import { MemoryUsageStore, type UsageStore } from '../../../src/shared/commands/store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
// Every voice-to-lists migration, in order: what the live table and function are.
const MIGRATIONS = fs
  .readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('_commands_usage.sql') || f.endsWith('_count_command.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.resolve('supabase/migrations', f), 'utf8'));

let pg: PGlite | null = null;
async function pgStore(): Promise<UsageStore> {
  if (!pg) {
    pg = new PGlite();
    await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      insert into auth.users values ('${A}'), ('${B}');`);
    for (const m of MIGRATIONS) await pg.exec(m);
  }
  await pg.exec('truncate public.command_usage');
  const db = pg;
  return new PgUsageStore({ query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows });
}

// Booting PGlite (WASM) can take longer than one test's 5 s while the whole suite runs.
beforeAll(() => pgStore(), 60_000);

afterAll(async () => {
  await pg?.close();
});

describe.each([
  ['memory', async () => new MemoryUsageStore() as UsageStore],
  ['postgres', pgStore],
])('%s usage store', (_, make) => {
  it('counts per account and per day', async () => {
    const s = await make();
    expect(await s.increment(A, '2026-10-29')).toBe(1);
    expect(await s.increment(A, '2026-10-29')).toBe(2);
    expect(await s.increment(B, '2026-10-29')).toBe(1);
    expect(await s.increment(A, '2026-10-30')).toBe(1);
  });
});

it('postgres drops an account’s days older than 30', async () => {
  const s = await pgStore();
  await s.increment(A, '2026-09-01');
  await s.increment(B, '2026-09-01');
  await s.increment(A, '2026-10-29');
  const rows = (await pg!.query<{ user_id: string; day: string }>("select user_id, to_char(day, 'YYYY-MM-DD') as day from public.command_usage order by user_id, day")).rows;
  expect(rows).toEqual([
    { user_id: A, day: '2026-10-29' },
    { user_id: B, day: '2026-09-01' },
  ]);
});

it('only the service role may run the counter', async () => {
  await pgStore();
  const grants = (
    await pg!.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name = 'count_command' order by grantee",
    )
  ).rows.map((r) => r.grantee);
  expect(grants).toContain('service_role');
  expect(grants).not.toContain('anon');
  expect(grants).not.toContain('authenticated');
  expect(grants).not.toContain('PUBLIC');
});

it('the REST store calls the function with the service key', async () => {
  const fetch = vi.fn(async () => new Response('3'));
  const s = new RestUsageStore({ url: 'https://p.supabase.co', serviceKey: 'sk', fetch: fetch as never });
  expect(await s.increment(A, '2026-10-30')).toBe(3);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://p.supabase.co/rest/v1/rpc/count_command');
  expect(init.headers).toMatchObject({ apikey: 'sk', authorization: 'Bearer sk' });
  expect(JSON.parse(init.body as string)).toEqual({ p_user: A, p_day: '2026-10-30' });
  await expect(new RestUsageStore({ url: 'u', serviceKey: 'k', fetch: (async () => new Response('no', { status: 500 })) as never }).increment(A, 'd')).rejects.toThrow('count_command 500');
});
