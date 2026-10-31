/** "38 / 120 min this month · resets 1 Nov" from seconds used/limit and the reset instant (local date). */
export function usageText(u: { used: number; limit: number; resetsAt: string }): string {
  const resets = new Date(u.resetsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${Math.floor(u.used / 60)} / ${Math.floor(u.limit / 60)} min this month · resets ${resets}`;
}
