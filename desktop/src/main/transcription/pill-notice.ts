import type { OverlayState } from '../../shared/channels';
import type { QuotaNotice } from './quota-watch';
import type { StorageNotice } from '../sync/storage-watch';

// Shows a Cloud minutes or storage notice on the pill. Only an idle pill (or another notice) is taken
// over: a "Saved" pill may have the user typing its title, and a recording or dictation is busy. A
// notice waits up to 10 s for that, and only counts as shown (for its month) once it is on screen.

const SHOW_MS = 6000;
const WAIT_MS = 10_000;
const POLL_MS = 500;

export type PillNoticeKind = QuotaNotice | StorageNotice;

const MESSAGE: Record<PillNoticeKind, string> = {
  low: 'Cloud minutes 80% used',
  out: 'Cloud minutes used',
  'storage-low': 'Cloud storage 80% full',
  'storage-full': 'Cloud storage full',
};

export class PillNotice {
  private seq = 0;

  constructor(
    private readonly d: {
      state(): OverlayState;
      set(s: OverlayState): void;
      idle(): OverlayState;
      /** The notice is on screen: remember it (for `period`, the minutes' month; '' for storage). */
      shown(notice: PillNoticeKind, period: string): void;
    },
  ) {}

  show(notice: PillNoticeKind, period: string, waitedMs = 0): void {
    const kind = this.d.state().kind;
    if (kind !== 'idle' && kind !== 'notice') {
      if (waitedMs < WAIT_MS) setTimeout(() => this.show(notice, period, waitedMs + POLL_MS), POLL_MS);
      return;
    }
    const mine = ++this.seq;
    this.d.set({ kind: 'notice', message: MESSAGE[notice], action: 'upgrade' });
    this.d.shown(notice, period);
    setTimeout(() => {
      if (mine === this.seq && this.d.state().kind === 'notice') this.d.set(this.d.idle());
    }, SHOW_MS);
  }
}
