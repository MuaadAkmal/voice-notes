import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadySubscribed,
  BadSignature,
  BillingCore,
  CheckoutBusy,
  NoSubscription,
  type PlanIds,
} from '../../../src/shared/billing/core';
import { handleBilling } from '../../../src/shared/billing/handler';
import {
  type Razorpay,
  RazorpayFailed,
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
    create schema storage; create table storage.objects (bucket_id text, name text, metadata jsonb, updated_at timestamptz default now());
    insert into auth.users values ('${A}'), ('${B}');`);
  for (const m of [
    '20261030105023_asr_usage.sql',
    '20261103065658_plan_limits.sql',
    '20261103065700_subscriptions.sql',
    '20261105092013_billing_storage_races.sql',
    '20261105093825_billing_status_rank.sql',
    '20261105094831_storage_oversized_sweep.sql',
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
    const sub = this.subs.get(id);
    if (!sub) throw new RazorpayFailed(`GET /subscriptions/${id} 404`);
    return sub;
  }
  async cancelAtCycleEnd(id: string) {
    this.cancelled.push(id);
    return this.subs.get(id)!;
  }
  async cancelNow(id: string) {
    const sub = this.subs.get(id)!;
    if (sub.status !== 'created') throw new Error(`can't cancel a ${sub.status} subscription`);
    sub.status = 'cancelled';
    return sub;
  }
}

let rzp: FakeRazorpay;
let core: BillingCore;
let store: BillingStore;
let clock: number;

beforeEach(async () => {
  await pg.exec(
    'truncate public.subscriptions, public.account_plans, public.asr_usage, storage.objects, public.billing_checkouts, public.storage_reservations',
  );
  rzp = new FakeRazorpay();
  clock = NOW;
  store = new BillingStore(pgBillingDb(pg));
  core = new BillingCore({
    store,
    razorpay: rzp,
    keyId: 'rzp_test_x',
    keySecret: KEY_SECRET,
    webhookSecret: HOOK_SECRET,
    plans: PLANS,
    now: () => clock,
  });
});

/**
 * A webhook arriving a moment after the last one. Razorpay's state becomes the event's, unless the
 * event is `late`: one Razorpay sent before the subscription moved on.
 */
async function hook(
  sub: Partial<RazorpaySubscription> & { id: string },
  event: string,
  at: number,
  { late = false } = {},
) {
  clock += 1;
  if (!late)
    rzp.subs.set(sub.id, {
      plan_id: 'plan_sm',
      status: 'created',
      current_end: null,
      notes: { user_id: A },
      ...rzp.subs.get(sub.id),
      ...sub,
    });
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
      { late: true },
    );
    expect(await plan(A)).toBe('free');
  });

  it('in the same second, a webhook saves what Razorpay has now, whatever the event said', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await hook({ id: 'sub_1', status: 'active' }, 'subscription.activated', T);
    await hook({ id: 'sub_1', status: 'authenticated' }, 'subscription.authenticated', T, { late: true });
    expect(await plan(A)).toBe('standard');
    await hook({ id: 'sub_1', status: 'cancelled' }, 'subscription.cancelled', T + 5);
    await hook({ id: 'sub_1', status: 'active' }, 'subscription.charged', T + 5, { late: true });
    expect(await plan(A)).toBe('free');
  });

  it('a subscription back from pending or halted in the same second gets its plan back', async () => {
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.activated', T);
    await hook({ id: 'sub_9', status: 'halted' }, 'subscription.halted', T + 9);
    expect(await plan(A)).toBe('free');
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.charged', T + 9);
    expect(await plan(A)).toBe('standard');
    await hook({ id: 'sub_9', status: 'pending' }, 'subscription.pending', T + 20);
    await hook({ id: 'sub_9', status: 'active' }, 'subscription.charged', T + 20);
    expect((await core.status(A)).subscription?.status).toBe('active');
  });

  it('saves at the same moment: active and halted go both ways; only the start and the end are ordered', async () => {
    const save = (status: string) =>
      store.save({
        id: 'sub_t',
        userId: A,
        razorpayPlanId: 'plan_sm',
        plan: 'standard',
        status,
        currentEnd: null,
        eventAt: new Date(NOW).toISOString(),
      });
    await save('active');
    await save('halted');
    expect(await plan(A)).toBe('free');
    await save('active');
    expect(await plan(A)).toBe('standard');
    await save('authenticated');
    expect(await plan(A)).toBe('standard');
    await save('cancelled');
    await save('active');
    expect(await plan(A)).toBe('free');
  });

  it('a webhook whose subscription Razorpay does not answer for fails, so Razorpay sends it again', async () => {
    const raw = JSON.stringify({
      event: 'subscription.activated',
      payload: { subscription: { entity: { id: 'sub_missing' } } },
    });
    await expect(core.webhook(raw, await hmacHex(HOOK_SECRET, raw))).rejects.toBeInstanceOf(RazorpayFailed);
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

  it('two checkouts at once: one goes through, the other is told to wait', async () => {
    const results = await Promise.allSettled([
      core.checkout(A, { plan: 'standard', period: 'monthly' }),
      core.checkout(A, { plan: 'pro', period: 'monthly' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(CheckoutBusy) });
    expect(rzp.subs.size).toBe(1);
    // Finished, the next checkout may start (a crashed one's claim lapses after two minutes).
    await core.checkout(A, { plan: 'pro', period: 'monthly' });
  });

  it('a new checkout cancels the earlier unpaid ones, so only one can be paid', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    await core.checkout(A, { plan: 'pro', period: 'annual' });
    expect(rzp.subs.get('sub_1')!.status).toBe('cancelled');
    expect(rzp.subs.get('sub_2')!.status).toBe('created');
    expect((await store.unpaid(A)).map((s) => s.id)).toEqual(['sub_2']);
  });

  it('an unpaid checkout that was paid after all blocks the new one', async () => {
    await core.checkout(A, { plan: 'standard', period: 'monthly' });
    rzp.subs.get('sub_1')!.status = 'active'; // paid, webhook not here yet
    await expect(core.checkout(A, { plan: 'pro', period: 'monthly' })).rejects.toBeInstanceOf(AlreadySubscribed);
    expect(await plan(A)).toBe('standard');
    expect(rzp.subs.size).toBe(1);
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

describe('storage_reserve', () => {
  const FREE = 262144000;
  const reserve = async (name: string, size: number, user = A) =>
    (await pg.query<{ ok: boolean }>('select ok from public.storage_reserve($1, $2, $3, $4)', [user, 'audio', `${user}/${name}`, size])).rows[0].ok;
  const upload = (name: string, size: number, user = A) =>
    pg.query("insert into storage.objects values ('audio', $1, jsonb_build_object('size', $2::bigint))", [`${user}/${name}`, size]);
  const oversized = async (user: string | null) =>
    (await pg.query<{ name: string }>('select name from public.storage_oversized($1)', [user])).rows.map((r) => r.name).sort();

  it('parallel uploads cannot share the same free space', async () => {
    expect(await reserve('a.webm', FREE - 10)).toBe(true);
    expect(await reserve('b.webm', 20)).toBe(false); // a's room is taken, though a hasn't arrived
    expect(await reserve('b.webm', 10)).toBe(true);
  });

  it('asking again for the same file replaces its reservation; an arrived file counts once', async () => {
    expect(await reserve('a.webm', FREE - 10)).toBe(true);
    expect(await reserve('a.webm', FREE - 10)).toBe(true); // a retry
    await upload('a.webm', FREE - 10);
    expect(await reserve('b.webm', 10)).toBe(true);
    expect(await reserve('a.webm', FREE - 10)).toBe(true); // a replacement doesn't count against itself
    expect(await reserve('c.webm', 1)).toBe(false);
  });

  it('reservations outlive the 2 hour upload URL, then lapse; they are per account', async () => {
    expect(await reserve('a.webm', FREE)).toBe(true);
    expect(await reserve('x.webm', FREE, B)).toBe(true);
    await pg.query("update public.storage_reservations set at = now() - interval '2 hours'");
    expect(await reserve('b.webm', 1)).toBe(false); // the URL may still be used
    await pg.query("update public.storage_reservations set at = now() - interval '2 hours 16 minutes'");
    expect(await reserve('b.webm', FREE)).toBe(true);
  });

  it('at most 20 files waiting to arrive per account', async () => {
    for (let i = 0; i < 20; i++) expect(await reserve(`${i}.webm`, 1)).toBe(true);
    expect(await reserve('21.webm', 1)).toBe(false);
    expect(await reserve('0.webm', 1)).toBe(true); // asking again for one already reserved
    await upload('0.webm', 1);
    expect(await reserve('21.webm', 1)).toBe(true);
  });

  it('lists files that arrived bigger than claimed, not ones written before their reservation', async () => {
    await pg.query("insert into storage.objects values ('audio', $1, '{\"size\": 500}', now() - interval '1 hour')", [`${A}/old.webm`]);
    expect(await reserve('old.webm', 10)).toBe(true); // an older, bigger copy is being replaced
    expect(await reserve('liar.webm', 1)).toBe(true);
    await upload('liar.webm', 50_000_000);
    expect(await oversized(A)).toEqual([`${A}/liar.webm`]);
  });

  it('the scheduled sweep lists every account, and lapsed reservations stay while they find an oversized file', async () => {
    expect(await reserve('liar.webm', 1)).toBe(true);
    expect(await reserve('fine.webm', 5)).toBe(true);
    expect(await reserve('liar.webm', 1, B)).toBe(true);
    await upload('liar.webm', 50_000_000);
    await upload('fine.webm', 5);
    await upload('liar.webm', 9, B);
    expect(await oversized(null)).toEqual([`${A}/liar.webm`, `${B}/liar.webm`]);
    await pg.query("update public.storage_reservations set at = now() - interval '3 hours'");
    await pg.query("update storage.objects set updated_at = now() - interval '3 hours'");
    await pg.query('select public.storage_prune_reservations(null)');
    expect(await oversized(null)).toEqual([`${A}/liar.webm`, `${B}/liar.webm`]);
    expect((await pg.query('select 1 from public.storage_reservations')).rows).toHaveLength(2);
    expect(await reserve('next.webm', 1)).toBe(true); // an upload's own pruning keeps them too
    expect(await oversized(A)).toEqual([`${A}/liar.webm`]);
  });
});
