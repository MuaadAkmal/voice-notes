// The `commands` Edge Function (voice to lists): asks Groq which of the user's pages a dictated
// command means and what to add. The rules and request handling live in ./_shared (copies of
// src/shared, made by `npm run sync:function`). The Groq key stays here.
// Each request may run in a fresh worker, so nothing slow is set up per request: the daily counter
// goes through the REST API (no database connection to open) and tokens are checked against the
// project's signing keys from the environment (no key download).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLocalJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { CommandsCore } from './_shared/commands/core.ts';
import { groqChat } from './_shared/commands/groq.ts';
import { handleCommands } from './_shared/commands/handler.ts';
import { RestUsageStore } from './_shared/commands/pg-store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const apiKey = Deno.env.get('GROQ_API_KEY') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const missing = [...(apiKey ? [] : ['GROQ_API_KEY']), ...(serviceKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY'])];

const auth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core = missing.length
  ? null
  : new CommandsCore({
      chat: groqChat({ apiKey, model: Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-20b', fetch }),
      usage: new RestUsageStore({ url: SUPABASE_URL, serviceKey, fetch }),
      dailyLimit: Number(Deno.env.get('COMMANDS_DAILY_LIMIT')) || 200,
      now: Date.now,
      timing: (steps) => console.log('[commands] ms', JSON.stringify(steps)),
    });

// The project's public signing keys, as the platform provides them; null if absent or unreadable.
const localKeys = (() => {
  try {
    const raw = JSON.parse(Deno.env.get('SUPABASE_JWKS') ?? '');
    return createLocalJWKSet(Array.isArray(raw?.keys) ? raw : { keys: Array.isArray(raw) ? raw : [raw] });
  } catch {
    return null;
  }
})();

async function verify(jwt: string): Promise<{ userId: string; via: string } | null> {
  if (localKeys) {
    try {
      const { payload } = await jwtVerify(jwt, localKeys, { issuer: `${SUPABASE_URL}/auth/v1` });
      return payload.sub && payload.role === 'authenticated' ? { userId: payload.sub, via: 'local' } : null;
    } catch {
      // A key the environment doesn't have yet (rotation) or a legacy token: let Auth decide.
    }
  }
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated') return null;
  return { userId: data.claims.sub as string, via: 'auth' };
}

Deno.serve((req) =>
  handleCommands(req, {
    verify: async (jwt) => {
      const t0 = Date.now();
      const user = await verify(jwt);
      console.log('[commands] ms', JSON.stringify({ verify: Date.now() - t0, via: user?.via ?? 'rejected' }));
      return user;
    },
    core,
    missing,
  }),
);
