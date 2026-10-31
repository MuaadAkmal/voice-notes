import type { StatusMap } from '../../shared/channels';

type Job = { id: string; language: string | null };

/** First in, first out, one job at a time: a single GPU server works best on one request at a time. */
export class TranscriptionQueue {
  private readonly jobs: Job[] = [];
  private readonly statuses: StatusMap = {};
  private running = false;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly run: (
      noteId: string,
      language: string | null,
    ) => Promise<void>,
    private readonly onChange: (s: StatusMap) => void,
  ) {}

  /** Notes already queued or running are skipped; finished or failed ones can go again. */
  enqueue(ids: string[], language: string | null): void {
    for (const id of ids) {
      const s = this.statuses[id];
      if (s && s.state !== 'failed') continue;
      this.jobs.push({ id, language });
      this.statuses[id] = { state: 'queued' };
    }
    this.next();
  }

  status(): StatusMap {
    return { ...this.statuses };
  }

  idle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private next(): void {
    if (this.running) {
      this.changed();
      return;
    }
    const job = this.jobs.shift();
    if (!job) {
      this.changed();
      const waiters = this.waiters;
      this.waiters = [];
      waiters.forEach((w) => w());
      return;
    }
    this.running = true;
    this.statuses[job.id] = { state: 'running' };
    this.changed();
    this.run(job.id, job.language)
      .then(
        () => delete this.statuses[job.id],
        (e: unknown) =>
          (this.statuses[job.id] = {
            state: 'failed',
            error: e instanceof Error ? e.message : String(e),
          }),
      )
      .finally(() => {
        this.running = false;
        this.next();
      });
  }

  private changed(): void {
    this.onChange(this.status());
  }
}
