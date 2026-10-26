// The `sync` Edge Function: Voice Notes' push/pull for two-PC sync. The rules, the request checks and
// the Postgres store live in ./_shared (copies of src/shared, made by `npm run sync:function`).
import postgres from 'npm:postgres@3.4.9';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { handle } from './_shared/sync/handler.ts';
import { type Db, PgStore } from './_shared/sync/pg-store.ts';
import { SyncCore } from './_shared/sync/server-core.ts';

// prepare: false keeps it working through Supavisor's transaction pooler too.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 4 });

// deno-lint-ignore no-explicit-any
function asDb(q: any): Db {
  return {
    query: (text, params = []) => q.unsafe(text, params as never[]),
    transaction: (fn) => (q.begin ? q.begin((tx: unknown) => fn(asDb(tx))) : fn(asDb(q))),
  };
}

const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core = new SyncCore(new PgStore(asDb(sql)));

/** The signed-in user's id from a verified access token; anything else is no one. */
async function verify(jwt: string): Promise<string | null> {
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return data.claims.sub as string;
}

Deno.serve((req) => handle(req, { verify, core }));
