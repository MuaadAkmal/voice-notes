// Taking back what a voice command added (Undo / Move to… on the pill): the `- item` lines
// `appendLine` wrote, found again by their exact text, from the end of the page.

/** The text as `appendLine` writes it. */
const asWritten = (text: string) => text.trim().replace(/\s*[\r\n]\s*/g, ' ');

/** Removes, for each text, the last `- text` line; a line the user changed is left. `removed` lists the texts found. */
export function removeLastLines(body: string, lines: readonly string[]): { body: string; removed: string[] } {
  const rows = body.split('\n');
  const removed: string[] = [];
  for (const text of lines) {
    const want = `- ${asWritten(text)}`;
    const at = rows.findLastIndex((r) => r.trimEnd() === want);
    if (at === -1) continue;
    rows.splice(at, 1);
    removed.push(text);
  }
  let out = rows.join('\n');
  if (out.trim() === '') out = '';
  else if (!out.endsWith('\n')) out += '\n';
  return { body: out, removed };
}
