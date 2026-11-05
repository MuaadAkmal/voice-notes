import {
  AlreadySubscribed,
  BadRequest,
  BadSignature,
  type BillingCore,
  CheckoutBusy,
  NoSubscription,
} from './core.ts';
import { RazorpayFailed } from './razorpay.ts';

// The `billing` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// `webhook` is Razorpay's (no token; its signature is the check); every other route needs the account's
// token, and the account always comes from it. Errors say what kind, never the internals. Browsers on
// `origins` (the website and web app) may call the account routes.

export type BillingHandlerDeps = {
  /** The user for a valid access token, else null. */
  verify(jwt: string): Promise<{ userId: string } | null>;
  /** Null when a secret is missing. */
  core: Pick<
    BillingCore,
    'checkout' | 'webhook' | 'verify' | 'cancel' | 'status'
  > | null;
  missing: string[];
  origins: string[];
};

const MAX_BODY = 1024 * 1024;

export async function handleBilling(
  req: Request,
  d: BillingHandlerDeps,
): Promise<Response> {
  const origin = req.headers.get('origin');
  const cors: Record<string, string> =
    origin && d.origins.includes(origin)
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-headers': 'authorization, apikey, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          vary: 'origin',
        }
      : {};
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...cors },
    });

  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: cors });
  if (!d.core) {
    console.error('[billing] missing secrets', d.missing.join(', '));
    return json(500, { error: 'misconfigured', missing: d.missing });
  }
  const route = new URL(req.url).pathname.split('/').pop();
  const post = req.method === 'POST';
  const known =
    (post &&
      ['webhook', 'checkout', 'verify', 'cancel'].includes(route ?? '')) ||
    (req.method === 'GET' && route === 'status');
  if (!known) return json(404, { error: 'Not found' });

  try {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY)
      return json(413, { error: 'too_large' });
    const raw = post ? await req.text() : '';
    if (raw.length > MAX_BODY) return json(413, { error: 'too_large' });

    if (route === 'webhook') {
      await d.core.webhook(raw, req.headers.get('x-razorpay-signature') ?? '');
      return json(200, { ok: true });
    }

    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const user = jwt ? await d.verify(jwt).catch(() => null) : null;
    if (!user) return json(401, { error: 'Sign in again' });

    if (route === 'status') return json(200, await d.core.status(user.userId));
    if (route === 'cancel') return json(200, await d.core.cancel(user.userId));
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad_request' });
    }
    if (route === 'checkout')
      return json(200, await d.core.checkout(user.userId, body as never));
    return json(200, await d.core.verify(user.userId, body as never));
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad_request' });
    if (err instanceof BadSignature)
      return json(400, { error: 'bad_signature' });
    if (err instanceof AlreadySubscribed)
      return json(409, { error: 'already_subscribed' });
    if (err instanceof CheckoutBusy)
      return json(409, { error: 'checkout_busy' });
    if (err instanceof NoSubscription)
      return json(404, { error: 'no_subscription' });
    if (err instanceof RazorpayFailed) {
      console.error('[billing] razorpay', err.message);
      return json(502, { error: 'provider_failed' });
    }
    console.error('[billing]', err instanceof Error ? err.message : err);
    return json(500, { error: 'Server error' });
  }
}
