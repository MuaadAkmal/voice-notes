import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadySubscribed,
  BadSignature,
  BillingCore,
  NoSubscription,
  type PlanIds,
} from '../../../src/shared/billing/core';
import { handleBilling } from '../../../src/shared/billing/handler';
import {
  type Razorpay,
  type RazorpaySubscription,
  hmacHex,
} from '../../../src/shared/billing/razorpay';
import { BillingStore, pgBillingDb } from '../../../src/shared/billing/store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 10, 3, 12); // 3 Nov 2026
const KEY_SECRET = 'key-secret';
const HOOK_SECRET = 'hook-secret';
const PLANS: PlanIds = {
  standard: { monthly: 'plan_sm', annual: 'plan_sa' },
  pro: { monthly: 'plan_pm', annual: 'plan_pa' },
};
const migration = (name: string) =>
  fs.readFileSync(path.resolve('../supabase/migrations', name), 'utf8');

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema auth; create table auth.users (id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create schema storage; create table storage.objects (bucket_id text, name text, metadata jsonb);
    insert into auth.users values ('${A}'), ('${B}');`);
  for (const m of [
    '20261030105023_asr_usage.sql',
    '20261103065658_plan_limits.sql',
    '20261103065700_subscriptions.sql',
  ])
    await pg.exec(migration(m));
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

/** Razorpay in memory: subscriptions it made, and the calls. */
class FakeRazorpay implements Razorpay {
  subs = new Map<string, RazorpaySubscription>();
  cancelled: string[] = [];
  private n = 0;
  async create(o: { planId: string; totalCount: number; userId: string }) {
    const sub = {
      id: `sub_${++this.n}`,
      plan_id: o.planId,
      status: 'created',
      current_end: null,
      short_url: `https://rzp.io/i/${this.n}`,
      notes: { user_id: o.userId },
    };
    this.subs.set(sub.id, sub);
    return sub;
  }
  async fetch(id: string) {
    return this.subs.get(id)!;
  }
  async cancelAtCycleEnd(id: string) {
    this.cancelled.push(id);
    return this.subs.get(id)!;
  }
}

let rzp: FakeRazorpay;
let core: BillingCore;
let store: BillingStore;

beforeEach(async () => {
  await pg.exec(
    'truncate public.subscriptions, public.account_plans, public.asr_usage, storage.objects',
  );
  rzp = new FakeRazorpay();
  store = new BillingStore(pgBillingDb(pg));
  core = new BillingCore({
    store,
    razorpay: rzp,
    keyId: 'rzp_test_x',
    keySecret: KEY_SECRET,
    webhookSecret: HOOK_SECRET,
    plans: PLANS,
    now: () => NOW,
  });
});

async function hook(
  sub: Partial<RazorpaySubscription> & { id: string },
  event: string,
  at: number,
) {
  const raw = JSON.stringify({
    event,
    created_at: at,
    payload: {
      subscription: {
        entity: {
          plan_id: 'plan_sm',
          current_end: null,
          notes: { user_id: A },
          ...sub,
        },
      },
    },
  });
  await core.webhook(raw, await hmacHex(HOOK_SECRET, raw));
}

const T = NOW / 1000;
const plan = async (u: string) => (await core.status(u)).plan;

describe('billing', () => {
  it('checkout creates a subscription for the account, and the plan waits for Razorpay', async () => {
    const r = await core.checkout(A, { plan: 'standard', period: 'annual' });
    expect(r).toEqual({
      subscriptionId: 'sub_1',
      keyId: 'rzp_test_x',
      shortUrl: 'https://rzp.io/i/1',
    });
    expect(rzp.subs.get('sub_1')).toMatchObject({
      plan_id: 'plan_sa',
      notes: { user_id: A },
    });
    expect(await plan(A)).toBe('free');
  });

  it('activated makes the account Standard, with its limits', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await hook(
      { id: 'sub_1', status: 'active', current_end: T + 30 * 86400 },
      'subscription.activated',
      T,
    );
    const s = await core.status(A);
    expect(s.plan).toBe('standard');
    expect(s.cloud).toEqual({
      used: 0,
      limit: 18000,
      resetsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(s.storage).toEqual({ used: 0, limit: 5368709120 });
    expect(s.subscription).toMatchObject({
      plan: 'standard',
      period: 'monthly',
      status: 'active',
      cancelAtPeriodEnd: false,
    });
  });

  it('an older event arriving late never undoes a newer one', async () => {
    await core.checkout(A, { plan: 'pro', period: 'monthly' });
    await hook(
      { id: 'sub_1', plan_id: 'plan_pm', status: 'halted' },
      'subscription.halted',
      T + 100,
    );
    await hook(
      { id: 'sub_1', plan_id: 'plan_pm', status: 'active' },
      'subscription.activated',
      T,
    );
    expect(await plan(A)).toBe('free');
  });

  it('the same event twice is harmless', async () => {
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.charged', T);
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.charged', T);
    expect(await plan(A)).toBe('standard');
  });

  it('pending keeps the plan while Razorpay retries; halted and cancelled drop to free', async () => {
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.activated', T);
    await hook(
      { id: 'sub_9', status: 'pending' },
      'subscription.pending',
      T + 1,
    );
    expect(await plan(A)).toBe('standard');
    await hook({ id: 'sub_9', status: 'halted' }, 'subscription.halted', T + 2);
    expect(await plan(A)).toBe('free');
    await hook(
      { id: 'sub_9', status: 'active' },
      'subscription.activated',
      T + 3,
    );
    await hook(
      { id: 'sub_9', status: 'cancelled' },
      'subscription.cancelled',
      T + 4,
    );
    expect(await plan(A)).toBe('free');
  });

  it('a bad signature, an unknown plan, or no account changes nothing', async () => {
    const raw = JSON.stringify({
      event: 'subscription.activated',
      created_at: T,
      payload: {
        subscription: {
          entity: {
            id: 'sub_x',
            plan_id: 'plan_sm',
            status: 'active',
            notes: { user_id: A },
          },
        },
      },
    });
    await expect(core.webhook(raw, 'deadbeef')).rejects.toBeInstanceOf(
      BadSignature,
    );
    await hook(
      { id: 'sub_y', plan_id: 'plan_other', status: 'active' },
      'subscription.activated',
      T,
    );
    await hook(
      { id: 'sub_z', status: 'active', notes: {} },
      'subscription.activated',
      T,
    );
    expect(await plan(A)).toBe('free');
  });

  it('a webhook cannot move a subscription to another account', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await hook(
      { id: 'sub_1', status: 'active', notes: { user_id: B } },
      'subscription.activated',
      T,
    );
    expect(await plan(A)).toBe('standard');
    expect(await plan(B)).toBe('free');
  });

  it('refuses a second checkout while one holds', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await hook({ id: 'sub_1', status: 'active' }, 'subscription.activated', T);
    await expect(
      core.checkout(A, { plan: 'pro', period: 'monthly' }),
    ).rejects.toBeInstanceOf(AlreadySubscribed);
  });

  it('verify checks the signature and the owner, then saves what Razorpay has', async () => {
    await core.checkout(A, { plan: 'pro', period: 'annual' });
    rzp.subs.get('sub_1')!.status = 'active';
    const signature = await hmacHex(KEY_SECRET, 'pay_1|sub_1');
    await expect(
      core.verify(A, {
        paymentId: 'pay_1',
        subscriptionId: 'sub_1',
        signature: 'bad',
      }),
    ).rejects.toBeInstanceOf(BadSignature);
    await expect(
      core.verify(B, {
        paymentId: 'pay_1',
        subscriptionId: 'sub_1',
        signature,
      }),
    ).rejects.toBeInstanceOf(NoSubscription);
    expect(
      (
        await core.verify(A, {
          paymentId: 'pay_1',
          subscriptionId: 'sub_1',
          signature,
        })
      ).plan,
    ).toBe('pro');
  });

  it('cancel stops renewal at the period end and keeps the plan until Razorpay ends it', async () => {
    await expect(core.cancel(A)).rejects.toBeInstanceOf(NoSubscription);
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await hook({ id: 'sub_1', status: 'active' }, 'subscription.activated', T);
    const s = await core.cancel(A);
    expect(rzp.cancelled).toEqual(['sub_1']);
    expect(s.plan).toBe('standard');
    expect(s.subscription?.cancelAtPeriodEnd).toBe(true);
  });
});

describe('billing handler', () => {
  const deps = () => ({
    verify: async (jwt: string) => (jwt === 'good' ? { userId: A } : null),
    core,
    missing: [],
    origins: ['https://app.voicenote.cloud'],
  });
  const req = (route: string, init: RequestInit = {}) =>
    new Request(`https://x/functions/v1/billing/${route}`, init);

  it('routes, token and CORS', async () => {
    expect((await handleBilling(req('nope'), deps())).status).toBe(404);
    expect((await handleBilling(req('status'), deps())).status).toBe(401);
    const res = await handleBilling(
      req('status', {
        headers: {
          authorization: 'Bearer good',
          origin: 'https://app.voicenote.cloud',
        },
      }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://app.voicenote.cloud',
    );
    expect((await res.json()).plan).toBe('free');
    const other = await handleBilling(
      req('status', {
        headers: {
          authorization: 'Bearer good',
          origin: 'https://evil.example',
        },
      }),
      deps(),
    );
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('the webhook needs no token but a good signature', async () => {
    const raw = JSON.stringify({
      event: 'payment.failed',
      created_at: T,
      payload: {},
    });
    const sig = await hmacHex(HOOK_SECRET, raw);
    expect(
      (
        await handleBilling(
          req('webhook', {
            method: 'POST',
            body: raw,
            headers: { 'x-razorpay-signature': sig },
          }),
          deps(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleBilling(
          req('webhook', {
            method: 'POST',
            body: raw,
            headers: { 'x-razorpay-signature': 'x' },
          }),
          deps(),
        )
      ).status,
    ).toBe(400);
  });

  it('checkout errors map to statuses', async () => {
    const post = (body: string) =>
      req('checkout', {
        method: 'POST',
        body,
        headers: { authorization: 'Bearer good' },
      });
    expect(
      (await handleBilling(post('{"plan":"gold","period":"monthly"}'), deps()))
        .status,
    ).toBe(400);
    expect((await handleBilling(post('not json'), deps())).status).toBe(400);
    expect(
      (await handleBilling(post('{"plan":"pro","period":"monthly"}'), deps()))
        .status,
    ).toBe(200);
  });

  it('missing secrets say which', async () => {
    const res = await handleBilling(req('status'), {
      ...deps(),
      core: null,
      missing: ['RAZORPAY_KEY_SECRET'],
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'misconfigured',
      missing: ['RAZORPAY_KEY_SECRET'],
    });
  });
});
