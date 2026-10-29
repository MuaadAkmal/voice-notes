// The `sync` Edge Function: Voice Notes' push/pull for two-PC sync, signed URLs for audio and images, and a ping to the other PCs after a push. The rules, the request checks, the
// Postgres store and its postgres.js adapter live in ./_shared (copies of src/shared, made by
// `npm run sync:function`; the store is contract-tested through postgres.js in tests/unit/sync/pg-wire.test.ts).
import postgres from 'npm:postgres@3.4.9';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { FileRules } from './_shared/sync/file-rules.ts';
import { handle } from './_shared/sync/handler.ts';
import { PgStore } from './_shared/sync/pg-store.ts';
import { postgresDb } from './_shared/sync/postgres-db.ts';
import { SyncCore } from './_shared/sync/server-core.ts';
import { SupabaseBucket } from './supabase-bucket.ts';

// prepare: false keeps it working through Supavisor's transaction pooler too.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 4 });

const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const store = new PgStore(postgresDb(sql));
const core = new SyncCore(store);

// Storage with the service role key, which only this server ever has (Edge Functions get it built in).
const storage = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const files = new FileRules(store, new SupabaseBucket(storage));

/** The signed-in user's id from a verified access token; anything else is no one. */
async function verify(jwt: string): Promise<string | null> {
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return data.claims.sub as string;
}

/** A Realtime broadcast on the account's private topic: its other PCs sync now. No content, only who pushed. */
async function notify(userId: string, from: string): Promise<void> {
  await sql`select realtime.send(${JSON.stringify({ from })}::jsonb, 'changed', ${`sync:${userId}`}, true)`;
}

Deno.serve((req) => handle(req, { verify, core, files, notify }));
