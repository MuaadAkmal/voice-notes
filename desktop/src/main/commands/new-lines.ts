// How many lines voice commands added to each page since it was last opened, for the "new" dot on its
// sidebar row and Home card. Per PC (the `newLines` setting, in pc.json): only this PC's commands count.

const MAX = 999;

export class NewLines {
  constructor(
    private readonly d: {
      get(): Record<string, number>;
      set(next: Record<string, number>): void;
      /** Whether the page still exists; counts for deleted pages are dropped on the next change. */
      exists(pageId: string): boolean;
    },
  ) {}

  add(pageId: string, n: number): void {
    if (n > 0) this.write(pageId, (c) => c + n);
  }

  /** Lines taken back (Undo, or Move to… another page). */
  remove(pageId: string, n: number): void {
    if (n > 0) this.write(pageId, (c) => c - n);
  }

  /** The page was opened. */
  seen(pageId: string): void {
    if (this.d.get()[pageId]) this.write(pageId, () => 0);
  }

  private write(pageId: string, change: (count: number) => number): void {
    const next: Record<string, number> = {};
    for (const [id, c] of Object.entries(this.d.get())) if (id !== pageId && this.d.exists(id)) next[id] = c;
    const count = Math.min(MAX, Math.max(0, change(this.d.get()[pageId] ?? 0)));
    if (count > 0) next[pageId] = count;
    this.d.set(next);
  }
}
