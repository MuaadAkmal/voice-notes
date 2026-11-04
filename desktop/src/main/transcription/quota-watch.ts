import type { Settings } from '../../shared/channels';
import { quotaState } from '../../shared/cloud-usage';

// Watches the Cloud minutes the `asr` function reports with each transcript. It says when to show
// the 80% and the minutes-used notices (once per month each, remembered across restarts), and
// whether auto-transcribe should hold off until the month resets.

type Periods = Pick<Settings, 'cloudWarnedPeriod' | 'cloudOutPeriod'>;
export type QuotaNotice = 'low' | 'out';

export class QuotaWatch {
  /** The resetsAt of the month that ran out; null while minutes are left (or no reset is known). */
  private outUntil: string | null = null;

  constructor(private readonly d: { getSettings(): Periods; save(patch: Partial<Periods>): void; now(): number }) {}

  /**
   * The notice to show now, if any. quiet: only learn whether minutes are out (at boot), never notify.
   * mark: false leaves remembering it to `shown`, for a caller that may not get it on screen.
   */
  observe(u: { used: number; limit: number; resetsAt: string }, o: { quiet?: boolean; mark?: boolean } = {}): QuotaNotice | null {
    const state = quotaState(u);
    this.outUntil = state === 'out' ? u.resetsAt || null : null;
    if (o.quiet || state === 'ok') return null;
    return this.once(state, u.resetsAt, o.mark ?? true);
  }

  /** A transcription was refused for minutes; resetsAt may be '' when the function didn't say. */
  exceeded(resetsAt: string, o: { mark?: boolean } = {}): QuotaNotice | null {
    this.outUntil = resetsAt || null;
    return this.once('out', resetsAt, o.mark ?? true);
  }

  /** The notice for `period` reached the screen. */
  shown(notice: QuotaNotice, period: string): void {
    this.d.save({ [notice === 'low' ? 'cloudWarnedPeriod' : 'cloudOutPeriod']: period });
  }

  paused(): boolean {
    return this.outUntil !== null && this.d.now() < Date.parse(this.outUntil);
  }

  private once(notice: QuotaNotice, period: string, mark: boolean): QuotaNotice | null {
    const key = notice === 'low' ? 'cloudWarnedPeriod' : 'cloudOutPeriod';
    if (this.d.getSettings()[key] === period) return null;
    if (mark) this.shown(notice, period);
    return notice;
  }
}
