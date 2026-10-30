import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PgAsrStore, RestAsrStore } from '../../../src/shared/asr/pg-store';
import { MemoryAsrStore, type AsrStore } from '../../../src/shared/asr/store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OCT = '2026-10-01';
const NOV = '2026-11-01';
const MIGRATION = fs.readFileSync(path.resolve('supabase/migrations/20261030105023_asr_usage.sql'), 'utf8');

let pg: PGlite | null = null;
async function pgStore(): Promise<AsrStore> {
  if (!pg) {
    pg = new PGlite();
    await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      insert into auth.users values ('${A}'), ('${B}');`);
    await pg.exec(MIGRATION);
  }
  await pg.exec('truncate public.asr_usage; truncate public.account_plans');
  const db = pg;
  return new PgAsrStore({ query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows });
}

afterAll(async () => {
  await pg?.close();
});

describe.each([
  ['memory', async () => new MemoryAsrStore() as AsrStore],
  ['postgres', pgStore],
])('%s asr store', (_, make) => {
  it('reserves under the cap', async () => {
    const s = await make();
    expect(await s.reserve(A, OCT, 60)).toEqual({ ok: true, used: 60, limit: 7200 });
    expect(await s.reserve(A, OCT, 40)).toEqual({ ok: true, used: 100, limit: 7200 });
    expect((await s.usage(B, OCT)).used).toBe(0);
  });

  it('exact cap', async () => {
    const s = await make();
    expect((await s.reserve(A, OCT, 7190)).ok).toBe(true);
    expect(await s.reserve(A, OCT, 10)).toEqual({ ok: true, used: 7200, limit: 7200 });
    expect(await s.reserve(A, OCT, 1)).toEqual({ ok: false, used: 7200, limit: 7200 });
    expect((await s.usage(A, OCT)).used).toBe(7200);
  });

  it('two concurrent reserves cannot both pass', async () => {
    const s = await make();
    const r = await Promise.all([s.reserve(A, OCT, 4000), s.reserve(A, OCT, 4000)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect((await s.usage(A, OCT)).used).toBe(4000);
  });

  it('a first reserve over the cap is refused', async () => {
    const s = await make();
    expect(await s.reserve(A, OCT, 7201)).toEqual({ ok: false, used: 0, limit: 7200 });
  });

  it('refund floors at 0', async () => {
    const s = await make();
    await s.reserve(A, OCT, 30);
    await s.refund(A, OCT, 20);
    expect((await s.usage(A, OCT)).used).toBe(10);
    await s.refund(A, OCT, 50);
    expect((await s.usage(A, OCT)).used).toBe(0);
    await s.refund(B, OCT, 5);
    expect((await s.usage(B, OCT)).used).toBe(0);
  });

  it('no plan row means free, 7200', async () => {
    const s = await make();
    expect(await s.usage(A, OCT)).toEqual({ used: 0, limit: 7200, plan: 'free' });
  });

  it('a new month starts at 0', async () => {
    const s = await make();
    await s.reserve(A, OCT, 7200);
    expect((await s.usage(A, NOV)).used).toBe(0);
    expect(await s.reserve(A, NOV, 5)).toEqual({ ok: true, used: 5, limit: 7200 });
  });
});

it('postgres uses the account plan limit', async () => {
  const s = await pgStore();
  await pg!.exec(`insert into public.plans (id, monthly_seconds) values ('pro', 36000) on conflict do nothing;
    insert into public.account_plans (user_id, plan) values ('${A}', 'pro')`);
  expect(await s.usage(A, OCT)).toEqual({ used: 0, limit: 36000, plan: 'pro' });
  expect((await s.reserve(A, OCT, 8000)).ok).toBe(true);
});

it('only the service role may run the functions', async () => {
  await pgStore();
  for (const fn of ['asr_limit_for', 'reserve_asr_seconds', 'refund_asr_seconds', 'asr_usage_for']) {
    const grants = (
      await pg!.query<{ grantee: string }>('select grantee from information_schema.routine_privileges where routine_name = $1', [fn])
    ).rows.map((r) => r.grantee);
    expect(grants).toContain('service_role');
    expect(grants).not.toContain('anon');
    expect(grants).not.toContain('authenticated');
    expect(grants).not.toContain('PUBLIC');
  }
});

it('the REST store calls the functions with the service key', async () => {
  const fetch = vi.fn(async (url: string) =>
    new Response(
      url.endsWith('reserve_asr_seconds')
        ? JSON.stringify([{ ok: true, used: 5, lim: 7200 }])
        : url.endsWith('asr_usage_for')
          ? JSON.stringify([{ used: 5, lim: 7200, plan: 'free' }])
          : '',
    ),
  );
  const s = new RestAsrStore({ url: 'https://p.supabase.co', serviceKey: 'sk', fetch: fetch as never });
  expect(await s.reserve(A, OCT, 5)).toEqual({ ok: true, used: 5, limit: 7200 });
  await s.refund(A, OCT, 5);
  expect(await s.usage(A, OCT)).toEqual({ used: 5, limit: 7200, plan: 'free' });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://p.supabase.co/rest/v1/rpc/reserve_asr_seconds');
  expect(init.headers).toMatchObject({ apikey: 'sk', authorization: 'Bearer sk' });
  expect(JSON.parse(init.body as string)).toEqual({ p_user: A, p_period: OCT, p_seconds: 5 });
  expect(fetch.mock.calls[1][0]).toBe('https://p.supabase.co/rest/v1/rpc/refund_asr_seconds');
  await expect(
    new RestAsrStore({ url: 'u', serviceKey: 'k', fetch: (async () => new Response('no', { status: 500 })) as never }).reserve(A, OCT, 1),
  ).rejects.toThrow('reserve_asr_seconds 500');
});
