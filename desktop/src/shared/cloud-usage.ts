/** Where an account's plan is bought, changed or cancelled (the web app; paid through Razorpay). */
export const PLAN_PAGE_URL = 'https://app.voicenote.cloud/account/';

const PLAN_NAMES: Record<string, string> = { free: 'Free', standard: 'Standard', pro: 'Pro' };

/** "Free", "Standard", "Pro"; an unknown plan id as it is. */
export const planName = (plan: string): string => PLAN_NAMES[plan] ?? plan;

/**
 * "38 / 120 min this month · resets 1 Nov" from seconds used/limit and the reset instant (local date).
 * Limits over 2 hours (the paid plans) read in hours: "1.5 / 5 h this month · resets 1 Dec".
 */
export function usageText(u: { used: number; limit: number; resetsAt: string }): string {
  const resets = new Date(u.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const amount =
    u.limit > 7200
      ? `${Math.floor((u.used / 3600) * 10) / 10} / ${Math.round((u.limit / 3600) * 10) / 10} h`
      : `${Math.floor(u.used / 60)} / ${Math.floor(u.limit / 60)} min`;
  return `${amount} this month · resets ${resets}`;
}
