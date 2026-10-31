// Pure: a day-log page (`## D Mon YYYY` sections, entries appended at the end) shown newest first,
// for the Review later card on Home. The stored body never changes; `lines[i]` says which stored
// line the i-th shown line is (-1 for a blank line added between sections), so a tick on the card
// can still be sent as an edit of the stored line.

export type Reordered = { text: string; lines: number[] };

const isEntry = (line: string) => /^[-*] /.test(line);

/** Days newest first, and within a day the newest entry first. Text before the first day stays on top. */
export function newestFirst(body: string): Reordered {
  const all = body.split('\n');
  const first = all.findIndex((l) => l.startsWith('## '));
  if (first < 0) return { text: body, lines: all.map((_, i) => i) };

  const out: number[] = [];
  let pre = first;
  while (pre > 0 && !all[pre - 1].trim()) pre--;
  for (let i = 0; i < pre; i++) out.push(i);

  // Each section: its heading, then items (an entry plus any lines under it), blanks dropped.
  type Section = { heading: number; items: number[][] };
  const sections: Section[] = [];
  for (let i = first; i < all.length; i++) {
    const line = all[i];
    if (line.startsWith('## ')) sections.push({ heading: i, items: [] });
    else if (!line.trim()) continue;
    else {
      const s = sections[sections.length - 1];
      if (isEntry(line) || !s.items.length) s.items.push([i]);
      else s.items[s.items.length - 1].push(i);
    }
  }

  sections.reverse().forEach((s, n) => {
    if (n > 0 || out.length) out.push(-1);
    out.push(s.heading);
    for (const item of [...s.items].reverse()) out.push(...item);
  });
  return { text: out.map((i) => (i < 0 ? '' : all[i])).join('\n') + '\n', lines: out };
}
