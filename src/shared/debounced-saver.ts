/** Collapses bursts of edits into one save of the latest value. */
export class DebouncedSaver<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private value: { v: T } | null = null;

  constructor(
    private readonly save: (v: T) => Promise<unknown>,
    private readonly delayMs: number,
  ) {}

  get pending(): boolean {
    return this.value !== null;
  }

  push(v: T): void {
    this.value = { v };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Save the pending value now, if any. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.value;
    this.value = null;
    if (pending) await this.save(pending.v);
  }

  /** Drop the pending value without saving. */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.value = null;
  }
}
