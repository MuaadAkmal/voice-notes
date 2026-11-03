// Wire types of the `billing` Edge Function (paid plans through Razorpay Subscriptions).

export type PaidPlan = 'standard' | 'pro';
export type Period = 'monthly' | 'annual';

export type CheckoutRequest = { plan: PaidPlan; period: Period };
/** Open Razorpay Checkout with `key` + `subscription_id`, or send the person to `shortUrl`. */
export type CheckoutResponse = {
  subscriptionId: string;
  keyId: string;
  shortUrl: string | null;
};

/** What Razorpay Checkout's success handler receives. */
export type VerifyRequest = {
  paymentId: string;
  subscriptionId: string;
  signature: string;
};

export type SubscriptionInfo = {
  plan: PaidPlan;
  period: Period | null;
  /** Razorpay's status: created, authenticated, active, pending, halted, cancelled, completed, expired, paused. */
  status: string;
  currentEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type StatusResponse = {
  /** The plan the limits come from: free, standard or pro. */
  plan: string;
  subscription: SubscriptionInfo | null;
  cloud: { used: number; limit: number; resetsAt: string };
  storage: { used: number; limit: number };
};

/** Billing cycles a subscription runs before Razorpay ends it (about 10 years either way). */
export const TOTAL_COUNT: Record<Period, number> = { monthly: 120, annual: 10 };
