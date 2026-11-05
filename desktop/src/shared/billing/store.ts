// Subscriptions and limits, over the SQL functions of *_subscriptions.sql, *_asr_usage.sql and
// *_plan_limits.sql. One store for both ways to reach them: a Postgres client (PGlite in tests) or
// PostgREST over HTTP with the service role key (the function).

export type SubscriptionRow = {
  id: string;
  userId: string;
  razorpayPlanId: string;
  plan: string;
  status: string;
  currentEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type SaveRow = Omit<SubscriptionRow, 'cancelAtPeriodEnd'> & {
  eventAt: string;
};

/** Calls `public.<fn>` with named arguments and returns its rows. */
export type BillingDb = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]>;
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const iso = (v: unknown) =>
  v instanceof Date
    ? v.toISOString()
    : v == null
      ? null
      : new Date(String(v)).toISOString();
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error('billing store: not a number');
  return n;
};

function toRow(r: Record<string, unknown>): SubscriptionRow {
  const id = str(r.id);
  const userId = str(r.user_id);
  if (!id || !userId) throw new Error('billing store: bad subscription row');
  return {
    id,
    userId,
    razorpayPlanId: String(r.razorpay_plan_id),
    plan: String(r.plan),
    status: String(r.status),
    currentEnd: iso(r.current_end),
    cancelAtPeriodEnd: r.cancel_at_period_end === true,
  };
}

export class BillingStore {
  constructor(private readonly db: BillingDb) {}

  async save(s: SaveRow): Promise<void> {
    await this.db.rpc('billing_save', {
      p_id: s.id,
      p_user: s.userId,
      p_razorpay_plan_id: s.razorpayPlanId,
      p_plan: s.plan,
      p_status: s.status,
      p_current_end: s.currentEnd,
      p_event_at: s.eventAt,
    });
  }

  async setCancel(id: string): Promise<void> {
    await this.db.rpc('billing_set_cancel', { p_id: id });
  }

  async subscription(id: string): Promise<SubscriptionRow | null> {
    const [r] = await this.db.rpc('billing_subscription', { p_id: id });
    return r ? toRow(r) : null;
  }

  async latest(user: string): Promise<SubscriptionRow | null> {
    const [r] = await this.db.rpc('billing_latest', { p_user: user });
    return r ? toRow(r) : null;
  }

  /** Claims the account's checkout: false while another checkout of the account is under way. */
  async beginCheckout(user: string): Promise<boolean> {
    const [r] = await this.db.rpc('billing_checkout_begin', { p_user: user });
    return r?.ok === true;
  }

  async endCheckout(user: string): Promise<void> {
    await this.db.rpc('billing_checkout_end', { p_user: user });
  }

  /** The account's checkouts started and never paid, oldest first. */
  async unpaid(user: string): Promise<SubscriptionRow[]> {
    return (await this.db.rpc('billing_unpaid', { p_user: user })).map(toRow);
  }

  async cloud(
    user: string,
    period: string,
  ): Promise<{ used: number; limit: number; plan: string }> {
    const [r] = await this.db.rpc('asr_usage_for', {
      p_user: user,
      p_period: period,
    });
    if (!r) throw new Error('billing store: asr_usage_for sent no row');
    return { used: num(r.used), limit: num(r.lim), plan: String(r.plan) };
  }

  async storage(user: string): Promise<{ used: number; limit: number }> {
    const [r] = await this.db.rpc('storage_usage_for', { p_user: user });
    if (!r) throw new Error('billing store: storage_usage_for sent no row');
    return { used: num(r.used), limit: num(r.lim) };
  }
}

/** The slice of a Postgres client the store needs (PGlite in tests). */
export type PgQuery = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export function pgBillingDb(pg: PgQuery): BillingDb {
  return {
    async rpc(fn, args) {
      const names = Object.keys(args);
      const call = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
      return (
        await pg.query<Record<string, unknown>>(
          `select * from public.${fn}(${call})`,
          Object.values(args),
        )
      ).rows;
    },
  };
}

/** PostgREST with the service role key (server side only). */
export function restBillingDb(o: {
  url: string;
  serviceKey: string;
  fetch: typeof fetch;
}): BillingDb {
  return {
    async rpc(fn, args) {
      const res = await o.fetch(`${o.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: o.serviceKey,
          authorization: `Bearer ${o.serviceKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok)
        throw new Error(
          `${fn} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
        );
      const text = await res.text();
      const v: unknown = text ? JSON.parse(text) : null;
      if (Array.isArray(v)) return v as Record<string, unknown>[];
      return v && typeof v === 'object' ? [v as Record<string, unknown>] : [];
    },
  };
}
