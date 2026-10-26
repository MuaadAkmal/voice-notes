// A task list item: indent, bullet (`-`, `*`, `+` or `1.`/`1)`), then `[ ]` / `[x]` / `[X]`.
const TASK = /^(\s*(?:[-*+]|\d+[.)]) +\[)([ xX])(\](?:\s|$))/;

/**
 * Ticks or unticks the task on line `lineIndex` (0-based, `\n`-separated) of `body`, changing only
 * its bracket character. An already matching line is left as it is. Null if that line is not a task.
 */
export function setTaskChecked(
  body: string,
  lineIndex: number,
  checked: boolean,
): string | null {
  const lines = body.split('\n');
  const line = lines[lineIndex];
  const m = line === undefined ? null : TASK.exec(line);
  if (!m) return null;
  if (/[xX]/.test(m[2]) === checked) return body;
  lines[lineIndex] = m[1] + (checked ? 'x' : ' ') + line.slice(m[1].length + 1);
  return lines.join('\n');
}

/** The 0-based line whose task changed between two versions of a body, and its new state. */
export function toggledTask(
  before: string,
  after: string,
): { line: number; checked: boolean } | null {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) return null;
  const changed = a.flatMap((l, i) => (l === b[i] ? [] : [i]));
  if (changed.length !== 1) return null;
  const m = TASK.exec(b[changed[0]]);
  return m ? { line: changed[0], checked: /[xX]/.test(m[2]) } : null;
}
