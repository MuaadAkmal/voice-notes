// Quick-add entries under a day heading, exactly as the desktop writes them (desktop/src/shared/learn-log.ts;
// parity-tested): the PCs find today's entries by this heading.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `## 25 Oct 2026`, built by hand so it never varies by locale. */
export function dayHeading(d: Date): string {
  return `## ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function lastSectionStart(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith("## ")) return i;
  return -1;
}

/** `- entry` under the heading of `d`, which is added when the last section isn't that day's. */
export function appendEntry(body: string, entry: string, d: Date): string {
  const text = entry.trim().replace(/\s*[\r\n]\s*/g, " ");
  if (!text) throw new Error("Entry is empty");
  const heading = dayHeading(d);
  const lines = body.split("\n");
  const last = lastSectionStart(lines);
  if (last >= 0 && lines[last] === heading) {
    const e = body.trimEnd().length;
    return `${body.slice(0, e)}\n- ${text}${body.slice(e)}`;
  }
  const separator = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${heading}\n- ${text}\n`;
}

/** The entries under the heading of `d`, when it is the last section. */
export function todayEntries(body: string, d: Date): string[] {
  const lines = body.split("\n");
  const last = lastSectionStart(lines);
  if (last < 0 || lines[last] !== dayHeading(d)) return [];
  const out: string[] = [];
  for (const line of lines.slice(last + 1)) {
    const m = /^[-*] (?:\[[ xX]\] )?(.*)$/.exec(line);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

/** Local 'YYYY-MM-DD', the day a quick-add is sent with. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
