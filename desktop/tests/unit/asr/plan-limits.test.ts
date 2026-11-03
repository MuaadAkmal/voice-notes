import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const migration = (name: string) =>
  fs.readFileSync(path.resolve('../supabase/migrations', name), 'utf8');

let pg: PGlite;

// Booting PGlite (WASM) can take longer than one test's 5 s while the whole suite runs.
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.objects (bucket_id text, name text, metadata jsonb);
    insert into auth.users values ('${A}'), ('${B}');`);
  await pg.exec(migration('20261030105023_asr_usage.sql'));
  await pg.exec(migration('20261103065658_plan_limits.sql'));
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function storage(user: string) {
  return (
    await pg.query<{ used: number; lim: number; plan: string }>(
      'select * from public.storage_usage_for($1)',
      [user],
    )
  ).rows[0];
}

describe('plan limits', () => {
  it('free is 30 min a month', async () => {
    const r = await pg.query<{ lim: number; plan: string }>(
      'select * from public.asr_limit_for($1)',
      [A],
    );
    expect(r.rows[0]).toEqual({ lim: 1800, plan: 'free' });
  });

  it('standard and pro raise the Cloud cap', async () => {
    await pg.exec(
      `insert into public.account_plans values ('${A}', 'standard'), ('${B}', 'pro')`,
    );
    const lim = async (u: string) =>
      (
        await pg.query<{ lim: number }>(
          'select lim from public.asr_limit_for($1)',
          [u],
        )
      ).rows[0].lim;
    expect(await lim(A)).toBe(18000);
    expect(await lim(B)).toBe(36000);
    await pg.exec('truncate public.account_plans');
  });

  it('sums only the account’s own audio and images', async () => {
    await pg.exec(`insert into storage.objects values
      ('audio', '${A}/n1.webm', '{"size": 1000}'),
      ('images', '${A}/p.png', '{"size": 500}'),
      ('audio', '${B}/n2.webm', '{"size": 9999}'),
      ('other', '${A}/x', '{"size": 7}')`);
    expect(await storage(A)).toEqual({
      used: 1500,
      lim: 262144000,
      plan: 'free',
    });
    await pg.exec(`insert into public.account_plans values ('${B}', 'pro')`);
    expect(await storage(B)).toEqual({
      used: 9999,
      lim: 21474836480,
      plan: 'pro',
    });
  });

  it('an account with no files uses 0', async () => {
    await pg.exec('truncate storage.objects');
    expect((await storage(A)).used).toBe(0);
  });
});
