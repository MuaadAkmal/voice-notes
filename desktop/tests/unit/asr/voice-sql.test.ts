import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const migration = (name: string) =>
  fs.readFileSync(path.resolve('../supabase/migrations', name), 'utf8');

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.objects (bucket_id text, name text, metadata jsonb, updated_at timestamptz default now());
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    insert into storage.buckets values ('audio', 'audio', false, 52428800, '{audio/webm}');
    insert into auth.users values ('${A}'), ('${B}');`);
  for (const m of [
    '20261030105023_asr_usage.sql',
    '20261103065658_plan_limits.sql',
    '20261103065700_subscriptions.sql',
    '20261106120000_polished_audio.sql',
  ])
    await pg.exec(migration(m));
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

const rows = async <T>(sql: string) => (await pg.query<T>(sql)).rows;

describe('voice clones', () => {
  it('put then get returns the id; a second put returns the first as old_voice_id', async () => {
    expect(await rows(`select * from public.voice_clone_put('${A}', 'v1')`)).toEqual([{ old_voice_id: null }]);
    expect(await rows(`select * from public.voice_clone_get('${A}')`)).toEqual([{ voice_id: 'v1' }]);
    expect(await rows(`select * from public.voice_clone_put('${A}', 'v2')`)).toEqual([{ old_voice_id: 'v1' }]);
    expect(await rows(`select * from public.voice_clone_get('${A}')`)).toEqual([{ voice_id: 'v2' }]);
  });

  it('counts one per account', async () => {
    expect(await rows(`select * from public.voice_clone_count()`)).toEqual([{ n: 1 }]);
    await pg.query(`select * from public.voice_clone_put('${B}', 'vb')`);
    expect(await rows(`select * from public.voice_clone_count()`)).toEqual([{ n: 2 }]);
  });

  it('delete returns the id, then get is empty and a second delete returns nothing', async () => {
    expect(await rows(`select * from public.voice_clone_delete('${A}')`)).toEqual([{ voice_id: 'v2' }]);
    expect(await rows(`select * from public.voice_clone_get('${A}')`)).toEqual([]);
    expect(await rows(`select * from public.voice_clone_delete('${A}')`)).toEqual([]);
  });

  it('is closed to the app roles', async () => {
    await pg.exec('set role authenticated');
    try {
      await expect(pg.query(`select * from public.voice_clone_get('${B}')`)).rejects.toThrow(/permission denied/);
      await expect(pg.query('select * from public.voice_clones')).rejects.toThrow(/permission denied/);
    } finally {
      await pg.exec('reset role');
    }
  });
});

describe('audio bucket', () => {
  it('allows webm and mpeg', async () => {
    const [row] = await rows<{ allowed_mime_types: string[] }>(
      `select allowed_mime_types from storage.buckets where id = 'audio'`,
    );
    expect(row.allowed_mime_types).toEqual(['audio/webm', 'audio/mpeg']);
  });

  it('keeps one audio/mpeg when the update runs again', async () => {
    await pg.exec(`update storage.buckets set allowed_mime_types = array_append(allowed_mime_types, 'audio/mpeg')
      where id = 'audio' and not ('audio/mpeg' = any(allowed_mime_types))`);
    const [row] = await rows<{ allowed_mime_types: string[] }>(
      `select allowed_mime_types from storage.buckets where id = 'audio'`,
    );
    expect(row.allowed_mime_types.filter((t) => t === 'audio/mpeg')).toHaveLength(1);
  });
});
