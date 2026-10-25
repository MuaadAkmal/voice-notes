/** Collapses bursts of edits into one save of the latest value. Saves never overlap. */
export class DebouncedSaver<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private value: { v: T } | null = null;
  private inflight: Promise<void> | null = null;
  private epoch = 0; // bumped by cancel() so a failed save doesn't resurrect a dropped value

  constructor(
    private readonly save: (v: T) => Promise<unknown>,
    private readonly delayMs: number,
    private readonly onError?: (e: unknown) => void,
  ) {}

  get pending(): boolean {
    return this.value !== null;
  }

  push(v: T): void {
    this.value = { v };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch((e) => this.onError?.(e));
    }, this.delayMs);
  }

  /** Wait for any save in flight, then save the pending value now, if any. Rejects if that save fails (the value stays pending). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.inflight) await this.inflight;
    const pending = this.value;
    if (!pending) return;
    this.value = null;
    const epoch = this.epoch;
    const op = Promise.resolve().then(() => this.save(pending.v));
    const tracked: Promise<void> = op.then(
      () => undefined,
      () => undefined,
    );
    this.inflight = tracked;
    try {
      await op;
    } catch (e) {
      if (this.value === null && this.epoch === epoch) this.value = pending;
      throw e;
    } finally {
      if (this.inflight === tracked) this.inflight = null;
    }
  }

  /** Drop the pending value without saving. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.value = null;
    this.epoch++;
  }
}
