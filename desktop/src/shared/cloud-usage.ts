import { MAX_SPEAK_CHARS } from './asr/protocol';

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

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** "180 MB of 250 MB", or in GB once the plan is 1 GB or more: "1.2 GB of 5 GB". */
export function storageText(u: { used: number; limit: number }): string {
  if (u.limit >= GB) {
    const gb = (b: number) => `${Math.round((b / GB) * 10) / 10}`;
    return `${gb(u.used)} GB of ${gb(u.limit)} GB`;
  }
  return `${Math.round(u.used / MB)} MB of ${Math.round(u.limit / MB)} MB`;
}

/** Where the month's Cloud minutes (or the account's storage) stand: low from 80% (time to warn), out at the limit. */
export function quotaState(u: { used: number; limit: number }): 'ok' | 'low' | 'out' {
  if (!Number.isFinite(u.used) || !Number.isFinite(u.limit) || u.limit <= 0) return 'ok';
  if (u.used >= u.limit) return 'out';
  return u.used >= u.limit * 0.8 ? 'low' : 'ok';
}

/** What making polished audio of a transcript of `chars` characters costs, as the server reserves it: 12 characters a second, at most 5000 characters read. */
export function polishedCostText(chars: number): string {
  const seconds = Math.ceil(Math.min(chars, MAX_SPEAK_CHARS) / 12);
  return `Uses about ${Math.max(1, Math.ceil(seconds / 60))} min of Cloud minutes`;
}
