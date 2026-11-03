import { BILLING_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";
import { supabase } from "./supabase";

// The `billing` Edge Function (paid plans through Razorpay Subscriptions) and Razorpay Checkout.
// The wire types mirror desktop/src/shared/billing/protocol.ts; switch to `@wire/billing/protocol`
// once that file is on this branch.

export type PaidPlan = "standard" | "pro";
export type Period = "monthly" | "annual";

export type SubscriptionInfo = {
  plan: PaidPlan;
  period: Period | null;
  status: string;
  currentEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingStatus = {
  plan: string;
  subscription: SubscriptionInfo | null;
  cloud: { used: number; limit: number; resetsAt: string };
  storage: { used: number; limit: number };
};

type CheckoutResponse = { subscriptionId: string; keyId: string; shortUrl: string | null };

/** The launch prices, as on voicenote.cloud's pricing section. */
export const PRICES: Record<PaidPlan, Record<Period, { now: string; was: string; unit: string; note?: string }>> = {
  standard: {
    monthly: { now: "₹129", was: "₹159", unit: "/month" },
    annual: { now: "₹1,299", was: "₹1,599", unit: "/year", note: "About ₹108 a month" },
  },
  pro: {
    monthly: { now: "₹299", was: "₹349", unit: "/month" },
    annual: { now: "₹2,999", was: "₹3,499", unit: "/year", note: "About ₹250 a month" },
  },
};

export const PLAN_NAMES: Record<string, string> = { free: "Free", standard: "Standard", pro: "Pro" };

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function call<T>(route: string, body?: object): Promise<T> {
  const token = (await supabase().auth.getSession()).data.session?.access_token;
  if (!token) throw new BillingError(401, "signed_out");
  let res: Response;
  try {
    res = await fetch(`${BILLING_URL}/${route}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new BillingError(0, "offline");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new BillingError(res.status, typeof data?.error === "string" ? data.error : "server_error");
  return data as T;
}

export const getStatus = () => call<BillingStatus>("status");
export const cancelSubscription = () => call<BillingStatus>("cancel", {});
const checkout = (plan: PaidPlan, period: Period) => call<CheckoutResponse>("checkout", { plan, period });
const verify = (r: RazorpayResult) =>
  call<BillingStatus>("verify", { paymentId: r.razorpay_payment_id, subscriptionId: r.razorpay_subscription_id, signature: r.razorpay_signature });

/** Holds a paid plan: a new checkout would be refused. */
export const holdsPlan = (s: BillingStatus) => !!s.subscription && ["authenticated", "active", "pending"].includes(s.subscription.status);

type RazorpayResult = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: "payment.failed", fn: (e: { error?: { description?: string } }) => void): void };
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

let loading: Promise<RazorpayCtor> | null = null;

/** Razorpay's Checkout script, loaded once (the CSP in public/_headers allows it). */
function loadRazorpay(): Promise<RazorpayCtor> {
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("no Razorpay"));
    };
    s.onerror = () => reject(new Error("Razorpay didn't load"));
    document.head.appendChild(s);
  }).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Starts a subscription and opens Razorpay Checkout over the page. Resolves with the account's status
 * once paid, or null if the person closed Checkout. Razorpay's webhook decides the plan either way;
 * verify only makes it show at once.
 */
export async function subscribe(plan: PaidPlan, period: Period, email: string | null, onFailed: (message: string) => void): Promise<BillingStatus | null> {
  const r = await checkout(plan, period);
  let Razorpay: RazorpayCtor;
  try {
    Razorpay = await loadRazorpay();
  } catch {
    // Script blocked: Razorpay's hosted page for the same subscription does the job.
    if (r.shortUrl) location.href = r.shortUrl;
    return null;
  }
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: r.keyId,
      subscription_id: r.subscriptionId,
      name: "Voice Notes",
      description: `${PLAN_NAMES[plan]}, ${period === "annual" ? "yearly" : "monthly"}`,
      prefill: email ? { email } : {},
      theme: { color: "#14151a" },
      handler: (result: RazorpayResult) => verify(result).then(resolve, reject),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.on("payment.failed", (e) => onFailed(e.error?.description || "The payment didn't go through."));
    rzp.open();
  });
}

// Where to come back to after Google sign-in, which always lands on /app/.
const RETURN_KEY = "vn.returnTo";

export function setReturnTo(path: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Storage blocked: sign-in lands on the notes instead.
  }
}

/** The saved path, removed as it's read; only same-site paths. */
export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path?.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

export function formatHours(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.round((seconds / 3600) * 10) / 10;
  return `${h} h`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
