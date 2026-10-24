import type { Note } from './channels';

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.floor(ms / 1000);
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

export function groupByDay(notes: Note[], now: number): { label: string; notes: Note[] }[] {
  const groups: { label: string; notes: Note[] }[] = [];
  for (const note of notes) {
    const label = dayGroupLabel(note.createdAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.notes.push(note);
    else groups.push({ label, notes: [note] });
  }
  return groups;
}

/** Electron wraps rejected invokes as "Error invoking remote method '<ch>': Error: <msg>"; keep just <msg>. */
export function cleanIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '');
}
