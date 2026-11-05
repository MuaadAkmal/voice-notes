import type { Settings } from '../../shared/channels';
import { quotaState } from '../../shared/cloud-usage';

// Watches the account's cloud storage (the `sync` function's `storage` route). It says when to show
// the 80% and the full notices: once each time usage crosses into that band, remembered across
// restarts, and ready to warn again once usage drops back under 80% (notes deleted, or a bigger plan).

export type StorageNotice = 'storage-low' | 'storage-full';

export class StorageWatch {
  constructor(private readonly d: { getSettings(): Pick<Settings, 'storageWarned'>; save(patch: Pick<Settings, 'storageWarned'>): void }) {}

  /** The notice to show now, if any; remembering it is left to `shown`, once it is on screen. */
  observe(u: { used: number; limit: number }): StorageNotice | null {
    const state = quotaState(u);
    const warned = this.d.getSettings().storageWarned;
    if (state === 'ok') {
      if (warned) this.d.save({ storageWarned: null });
      return null;
    }
    if (state === 'out') return warned === 'full' ? null : 'storage-full';
    return warned ? null : 'storage-low'; // low: already warned for low (or full) this time round
  }

  shown(notice: StorageNotice): void {
    this.d.save({ storageWarned: notice === 'storage-full' ? 'full' : 'low' });
  }
}
