// The `billing` Edge Function: paid plans through Razorpay Subscriptions. Starts checkout, takes
// Razorpay's webhooks (deployed with verify_jwt off: Razorpay sends no token, the signature is the
// check) and tells the apps the account's plan and usage. The rules and request handling live in
// ./_shared (copies of src/shared, made by `npm run sync:function`). The Razorpay secrets stay here.
// Same token check as `asr`: the project's signing keys from the environment, Auth as fallback.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLocalJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { BillingCore } from './_shared/billing/core.ts';
import { handleBilling } from './_shared/billing/handler.ts';
import { razorpayApi } from './_shared/billing/razorpay.ts';
import { BillingStore, restBillingDb } from './_shared/billing/store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const env = (name: string) => Deno.env.get(name) ?? '';
const REQUIRED = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_PLAN_STANDARD_MONTHLY',
  'RAZORPAY_PLAN_STANDARD_ANNUAL',
  'RAZORPAY_PLAN_PRO_MONTHLY',
  'RAZORPAY_PLAN_PRO_ANNUAL',
];
const missing = REQUIRED.filter((name) => !env(name));

const auth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth;

const core = missing.length
  ? null
  : new BillingCore({
      store: new BillingStore(restBillingDb({ url: SUPABASE_URL, serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'), fetch })),
      razorpay: razorpayApi(env('RAZORPAY_KEY_ID'), env('RAZORPAY_KEY_SECRET'), fetch),
      keyId: env('RAZORPAY_KEY_ID'),
      keySecret: env('RAZORPAY_KEY_SECRET'),
      webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
      plans: {
        standard: { monthly: env('RAZORPAY_PLAN_STANDARD_MONTHLY'), annual: env('RAZORPAY_PLAN_STANDARD_ANNUAL') },
        pro: { monthly: env('RAZORPAY_PLAN_PRO_MONTHLY'), annual: env('RAZORPAY_PLAN_PRO_ANNUAL') },
      },
      now: Date.now,
    });

// The website, the web app, and the web app's dev server (as `sync` allows it).
const origins = ['https://voicenote.cloud', 'https://www.voicenote.cloud', 'https://app.voicenote.cloud', 'http://localhost:3000'];

// The project's public signing keys, as the platform provides them; null if absent or unreadable.
const localKeys = (() => {
  try {
    const raw = JSON.parse(Deno.env.get('SUPABASE_JWKS') ?? '');
    return createLocalJWKSet(Array.isArray(raw?.keys) ? raw : { keys: Array.isArray(raw) ? raw : [raw] });
  } catch {
    return null;
  }
})();

async function verify(jwt: string): Promise<{ userId: string } | null> {
  if (localKeys) {
    try {
      const { payload } = await jwtVerify(jwt, localKeys, { issuer: `${SUPABASE_URL}/auth/v1` });
      return payload.sub && payload.role === 'authenticated' && payload.is_anonymous !== true ? { userId: payload.sub } : null;
    } catch {
      // A key the environment doesn't have yet (rotation) or a legacy token: let Auth decide.
    }
  }
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims?.sub || data.claims.role !== 'authenticated' || data.claims.is_anonymous === true) return null;
  return { userId: data.claims.sub as string };
}

Deno.serve((req) => handleBilling(req, { verify, core, missing, origins }));
