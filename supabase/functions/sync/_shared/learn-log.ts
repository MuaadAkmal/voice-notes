// Pure "learned today" entry format for text-note bodies. Rules: spec "Entry format".
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `## 25 Oct 2026`, built by hand so it never varies by OS locale. */
export function dayHeading(d: Date): string {
  return `## ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function lastSectionStart(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--)
    if (lines[i].startsWith('## ')) return i;
  return -1;
}

export function appendEntry(body: string, entry: string, d: Date): string {
  const text = entry.trim().replace(/\s*[\r\n]\s*/g, ' ');
  if (!text) throw new Error('Entry is empty');
  const heading = dayHeading(d);
  const lines = body.split('\n');
  const last = lastSectionStart(lines);
  if (last >= 0 && lines[last] === heading) {
    const e = body.trimEnd().length;
    return `${body.slice(0, e)}\n- ${text}${body.slice(e)}`;
  }
  const separator =
    body === '' || body.endsWith('\n\n')
      ? ''
      : body.endsWith('\n')
        ? '\n'
        : '\n\n';
  return `${body}${separator}${heading}\n- ${text}\n`;
}

export function todayEntries(body: string, d: Date): string[] {
  const lines = body.split('\n');
  const last = lastSectionStart(lines);
  if (last < 0 || lines[last] !== dayHeading(d)) return [];
  const out: string[] = [];
  for (const line of lines.slice(last + 1)) {
    const m = /^[-*] (?:\[[ xX]\] )?(.*)$/.exec(line);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}
