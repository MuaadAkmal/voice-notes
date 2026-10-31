// How many commands each account sent per day: the daily cap that keeps the LLM bill bounded.

export interface UsageStore {
  /** Counts one command for `day` ('YYYY-MM-DD', UTC) and returns that day's count so far. */
  increment(userId: string, day: string): Promise<number>;
}

export class MemoryUsageStore implements UsageStore {
  private readonly counts = new Map<string, number>();

  async increment(userId: string, day: string): Promise<number> {
    const key = `${userId} ${day}`;
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
}
