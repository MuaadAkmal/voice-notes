import {
  type CheckoutRequest,
  type CheckoutResponse,
  type PaidPlan,
  type Period,
  type StatusResponse,
  TOTAL_COUNT,
  type VerifyRequest,
} from './protocol.ts';
import {
  type Razorpay,
  type RazorpaySubscription,
  hmacHex,
  sameHex,
} from './razorpay.ts';
import type { BillingStore } from './store.ts';

// Paid plans through Razorpay Subscriptions. Razorpay's webhooks decide the plan: each one carries the
// subscription's whole state, saved unless a newer state is already saved, so repeats and late
// arrivals are harmless. Checkout's success only makes the app see it sooner (verify fetches the
// subscription from Razorpay instead of trusting the browser). Pure TypeScript (runs in Node and Deno).

export type PlanIds = Record<PaidPlan, Record<Period, string>>;

export class BadRequest extends Error {}
export class BadSignature extends Error {}
export class AlreadySubscribed extends Error {}
export class NoSubscription extends Error {}
/** Another checkout of the account is under way (another tab). */
export class CheckoutBusy extends Error {}

/** Statuses that hold a subscription: a new checkout is refused while one exists. */
const HOLDING = new Set(['authenticated', 'active', 'pending']);
const PAID: readonly string[] = ['standard', 'pro'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A checkout's own first save: any state Razorpay sends later replaces it. */
const BEFORE_ANY_EVENT = new Date(0).toISOString();

export type BillingCoreDeps = {
  store: BillingStore;
  razorpay: Razorpay;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  plans: PlanIds;
  now: () => number;
};

/** First day of the month (UTC) and the first of the next. */
function monthOf(ms: number): { period: string; resetsAt: string } {
  const d = new Date(ms);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return {
    period: start.toISOString().slice(0, 10),
    resetsAt: next.toISOString(),
  };
}

const toIso = (unix: number | null | undefined) =>
  typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null;

export class BillingCore {
  constructor(private readonly d: BillingCoreDeps) {}

  private planOf(
    razorpayPlanId: string,
  ): { plan: PaidPlan; period: Period } | null {
    for (const plan of ['standard', 'pro'] as const)
      for (const period of ['monthly', 'annual'] as const)
        if (this.d.plans[plan][period] === razorpayPlanId)
          return { plan, period };
    return null;
  }

  async checkout(
    userId: string,
    req: CheckoutRequest,
  ): Promise<CheckoutResponse> {
    if (
      !PAID.includes(req?.plan) ||
      (req.period !== 'monthly' && req.period !== 'annual')
    )
      throw new BadRequest('plan');
    // One checkout at a time per account, so two tabs can't both pass the check below.
    if (!(await this.d.store.beginCheckout(userId))) throw new CheckoutBusy();
    try {
      const latest = await this.d.store.latest(userId);
      if (latest && HOLDING.has(latest.status)) throw new AlreadySubscribed();
      // Checkouts left unpaid stay payable at Razorpay: cancel them, so only the newest can be paid.
      for (const old of await this.d.store.unpaid(userId))
        await this.retire(old.id);
      const planId = this.d.plans[req.plan][req.period];
      const sub = await this.d.razorpay.create({
        planId,
        totalCount: TOTAL_COUNT[req.period],
        userId,
      });
      await this.d.store.save({
        id: sub.id,
        userId,
        razorpayPlanId: planId,
        plan: req.plan,
        status: sub.status,
        currentEnd: toIso(sub.current_end),
        eventAt: BEFORE_ANY_EVENT,
      });
      return {
        subscriptionId: sub.id,
        keyId: this.d.keyId,
        shortUrl: sub.short_url ?? null,
      };
    } finally {
      await this.d.store.endCheckout(userId);
    }
  }

  /** Cancels a checkout never paid. One Razorpay already moved on (expired, or paid after all) is saved as it is. */
  private async retire(id: string): Promise<void> {
    let sub: RazorpaySubscription;
    try {
      sub = await this.d.razorpay.cancelNow(id);
    } catch (err) {
      sub = await this.d.razorpay.fetch(id);
      if (sub.status === 'created') throw err;
    }
    await this.apply(sub, new Date(this.d.now()).toISOString());
    if (HOLDING.has(sub.status)) throw new AlreadySubscribed();
  }

  /** A Razorpay webhook. Events other than subscription.* are acknowledged and ignored. */
  async webhook(raw: string, signature: string): Promise<void> {
    if (
      !signature ||
      !sameHex(await hmacHex(this.d.webhookSecret, raw), signature)
    )
      throw new BadSignature();
    let event: {
      event?: unknown;
      payload?: { subscription?: { entity?: RazorpaySubscription } };
    };
    try {
      event = JSON.parse(raw);
    } catch {
      throw new BadRequest('json');
    }
    if (
      typeof event.event !== 'string' ||
      !event.event.startsWith('subscription.')
    )
      return;
    const entity = event.payload?.subscription?.entity;
    if (!entity?.id) return;
    // Razorpay stamps events in whole seconds and doesn't promise their order, so an event only says
    // which subscription changed: its state is read from Razorpay now, never older than the event.
    const sub = await this.d.razorpay.fetch(entity.id);
    await this.apply(sub, new Date(this.d.now()).toISOString());
  }

  private async apply(
    sub: RazorpaySubscription,
    eventAt: string,
  ): Promise<void> {
    const plan = this.planOf(sub.plan_id);
    if (!plan) {
      console.warn('[billing] unknown plan', sub.plan_id, sub.id);
      return;
    }
    const notes = sub.notes && !Array.isArray(sub.notes) ? sub.notes : {};
    const userId =
      (await this.d.store.subscription(sub.id))?.userId ?? notes.user_id;
    if (!userId || !UUID.test(userId)) {
      console.warn('[billing] no account for', sub.id);
      return;
    }
    await this.d.store.save({
      id: sub.id,
      userId,
      razorpayPlanId: sub.plan_id,
      plan: plan.plan,
      status: sub.status,
      currentEnd: toIso(sub.current_end),
      eventAt,
    });
  }

  /** Checkout's success handler: checks Razorpay's signature, then saves the subscription as Razorpay has it now. */
  async verify(userId: string, req: VerifyRequest): Promise<StatusResponse> {
    if (
      typeof req?.paymentId !== 'string' ||
      typeof req.subscriptionId !== 'string' ||
      typeof req.signature !== 'string'
    )
      throw new BadRequest('verify');
    const expected = await hmacHex(
      this.d.keySecret,
      `${req.paymentId}|${req.subscriptionId}`,
    );
    if (!sameHex(expected, req.signature)) throw new BadSignature();
    const row = await this.d.store.subscription(req.subscriptionId);
    if (!row || row.userId !== userId) throw new NoSubscription();
    await this.apply(
      await this.d.razorpay.fetch(req.subscriptionId),
      new Date(this.d.now()).toISOString(),
    );
    return this.status(userId);
  }

  /** Stops renewal; the plan lasts to the end of the period already paid. */
  async cancel(userId: string): Promise<StatusResponse> {
    const latest = await this.d.store.latest(userId);
    if (!latest || !HOLDING.has(latest.status)) throw new NoSubscription();
    await this.d.razorpay.cancelAtCycleEnd(latest.id);
    await this.d.store.setCancel(latest.id);
    return this.status(userId);
  }

  async status(userId: string): Promise<StatusResponse> {
    const { period, resetsAt } = monthOf(this.d.now());
    const [cloud, storage, latest] = await Promise.all([
      this.d.store.cloud(userId, period),
      this.d.store.storage(userId),
      this.d.store.latest(userId),
    ]);
    const paid = latest && PAID.includes(latest.plan) ? latest : null;
    return {
      plan: cloud.plan,
      subscription: paid && {
        plan: paid.plan as PaidPlan,
        period: this.planOf(paid.razorpayPlanId)?.period ?? null,
        status: paid.status,
        currentEnd: paid.currentEnd,
        cancelAtPeriodEnd: paid.cancelAtPeriodEnd,
      },
      cloud: { used: cloud.used, limit: cloud.limit, resetsAt },
      storage,
    };
  }
}
