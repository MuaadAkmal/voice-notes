// When the start ping stops sounding. The auto-pause probe listens to the speakers and would take
// the ping for playing media, so it waits this out.
let endsAt = 0;

/** The ping plays for the next `ms`. */
export function markPing(ms: number): void {
  endsAt = Date.now() + ms;
}

export function pingSounding(): boolean {
  return Date.now() < endsAt;
}

/** Resolves once no ping is sounding; if one is, `settleMs` after it ends (for a probe that looks back in time). */
export function afterPing(settleMs = 0): Promise<void> {
  const wait = endsAt - Date.now();
  if (wait <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, wait + settleMs));
}
