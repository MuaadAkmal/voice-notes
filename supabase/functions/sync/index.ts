// The `sync` Edge Function: Voice Notes' push/pull for two-PC sync. The rules, the request checks, the
// Postgres store and its postgres.js adapter live in ./_shared (copies of src/shared, made by
// `npm run sync:function`; the store is contract-tested through postgres.js in tests/unit/sync/pg-wire.test.ts).
import postgres from 'npm:postgres@3.4.9';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './_shared/sync/handler.ts';
import { PgStore } from './_shared/sync/pg-store.ts';
import { postgresDb } from './_shared/sync/postgres-db.ts';
import { SyncCore } from './_shared/sync/server-core.ts';

// prepare: false keeps it working through Supavisor's transaction pooler too.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 4 });

const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core = new SyncCore(new PgStore(postgresDb(sql)));

/** The signed-in user's id from a verified access token; anything else is no one. */
async function verify(jwt: string): Promise<string | null> {
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return data.claims.sub as string;
}

Deno.serve((req) => handle(req, { verify, core }));
