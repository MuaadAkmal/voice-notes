// The `connectors` Edge Function: connects an account's Google Calendar (consent, encrypted refresh
// token) and hands the app short-lived access tokens. The rules, the request handling and the Postgres
// store live in ./_shared (copies of src/shared, made by `npm run sync:function`).
// Deployed with verify_jwt off: Google's redirect carries no token. Every other route verifies it.
import postgres from 'npm:postgres@3.4.9';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ConnectorsCore } from './_shared/connectors/core.ts';
import { aesGcmCipher } from './_shared/connectors/crypto.ts';
import { googleOAuth } from './_shared/connectors/google-oauth.ts';
import { handleConnectors } from './_shared/connectors/handler.ts';
import { PgConnectorStore } from './_shared/connectors/pg-store.ts';

const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTORS_KEY'] as const;
const env = Object.fromEntries(SECRETS.map((k) => [k, Deno.env.get(k) ?? ''])) as Record<(typeof SECRETS)[number], string>;
const missing: string[] = SECRETS.filter((k) => !env[k]);

const cipher = env.CONNECTORS_KEY
  ? await aesGcmCipher(env.CONNECTORS_KEY).catch(() => {
      missing.push('CONNECTORS_KEY (must be 32 bytes, base64)');
      return null;
    })
  : null;

// prepare: false keeps it working through Supavisor's transaction pooler too.
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });

const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core =
  missing.length || !cipher
    ? null
    : new ConnectorsCore({
        store: new PgConnectorStore({ query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never }),
        google: googleOAuth({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, fetch }),
        cipher,
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/connectors/google/callback`,
        now: Date.now,
        randomState: () => {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        },
      });

/** The signed-in user from a verified access token; anything else is no one. */
async function verify(jwt: string): Promise<{ userId: string; email: string | null } | null> {
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return { userId: data.claims.sub as string, email: typeof data.claims.email === 'string' ? data.claims.email : null };
}

Deno.serve((req) => handleConnectors(req, { verify, core, missing }));
