// Seconds of audio each account transcribed per month: the cap that keeps the provider bill bounded.

export const FREE_PLAN = 'free';
export const FREE_SECONDS = 7200;

export interface AsrStore {
  /** Adds `seconds` to the month (`period` = 'YYYY-MM-01') only if the total stays within the cap. */
  reserve(user: string, period: string, seconds: number): Promise<{ ok: boolean; used: number; limit: number }>;
  /** Gives back seconds reserved for a clip that failed; never below 0. */
  refund(user: string, period: string, seconds: number): Promise<void>;
  usage(user: string, period: string): Promise<{ used: number; limit: number; plan: string }>;
}

export class MemoryAsrStore implements AsrStore {
  private readonly used = new Map<string, number>();
  private readonly plans = new Map<string, { plan: string; limit: number }>();

  /** Tests: give an account another plan. */
  setPlan(user: string, plan: string, limit: number): void {
    this.plans.set(user, { plan, limit });
  }

  private plan(user: string) {
    return this.plans.get(user) ?? { plan: FREE_PLAN, limit: FREE_SECONDS };
  }

  // Check and add with no await in between, so concurrent calls can't both pass.
  async reserve(user: string, period: string, seconds: number) {
    const key = `${user} ${period}`;
    const { limit } = this.plan(user);
    const now = this.used.get(key) ?? 0;
    if (seconds <= 0 || now + seconds > limit) return { ok: false, used: now, limit };
    this.used.set(key, now + seconds);
    return { ok: true, used: now + seconds, limit };
  }

  async refund(user: string, period: string, seconds: number) {
    const key = `${user} ${period}`;
    const now = this.used.get(key);
    if (now !== undefined) this.used.set(key, Math.max(0, now - Math.max(0, seconds)));
  }

  async usage(user: string, period: string) {
    const { plan, limit } = this.plan(user);
    return { used: this.used.get(`${user} ${period}`) ?? 0, limit, plan };
  }
}
