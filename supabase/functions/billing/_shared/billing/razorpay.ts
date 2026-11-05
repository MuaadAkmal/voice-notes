// The slice of Razorpay's REST API the `billing` function uses, and its signature checks. Keys stay on
// the server. Web Crypto only, so it runs in Node and Deno.

export type RazorpaySubscription = {
  id: string;
  plan_id: string;
  status: string;
  current_end: number | null;
  short_url?: string | null;
  notes?: Record<string, string> | unknown[];
};

export class RazorpayFailed extends Error {}

export interface Razorpay {
  create(o: {
    planId: string;
    totalCount: number;
    userId: string;
  }): Promise<RazorpaySubscription>;
  fetch(id: string): Promise<RazorpaySubscription>;
  cancelAtCycleEnd(id: string): Promise<RazorpaySubscription>;
  /** Cancels at once: for a checkout never paid, so it can't be paid later. */
  cancelNow(id: string): Promise<RazorpaySubscription>;
}

export function razorpayApi(
  keyId: string,
  keySecret: string,
  fetchFn: typeof fetch,
  base = 'https://api.razorpay.com/v1',
): Razorpay {
  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;
  async function call(
    method: string,
    path: string,
    body?: object,
  ): Promise<RazorpaySubscription> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok)
      throw new RazorpayFailed(
        `${method} ${path} ${res.status}: ${text.slice(0, 300)}`,
      );
    return JSON.parse(text) as RazorpaySubscription;
  }
  return {
    create: (o) =>
      call('POST', '/subscriptions', {
        plan_id: o.planId,
        total_count: o.totalCount,
        customer_notify: 1,
        notes: { user_id: o.userId },
      }),
    fetch: (id) => call('GET', `/subscriptions/${encodeURIComponent(id)}`),
    cancelAtCycleEnd: (id) =>
      call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
        cancel_at_cycle_end: 1,
      }),
    cancelNow: (id) =>
      call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
        cancel_at_cycle_end: 0,
      }),
  };
}

export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(message)),
  );
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares in time that doesn't depend on where they differ. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
