const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

export function defaultTitle(date: Date): string {
  return `Voice note · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function dayGroupLabel(ts: number, now: number): string {
  const day = startOfDay(ts);
  const today = startOfDay(now);
  if (day === today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return 'Yesterday';
  const part = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', opts).format(ts);
  return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}

export function groupByDay<T>(items: T[], now: number, timeOf: (t: T) => number): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayGroupLabel(timeOf(item), now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** Split into batches of at most `n`, in order. */
export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Decimal units, as download sizes are usually given: "148 MB", "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Electron wraps rejected invokes as "Error invoking remote method '<ch>': Error: <msg>"; keep just <msg>. */
export function cleanIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
}
