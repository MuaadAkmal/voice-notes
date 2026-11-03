// Task list lines, as the desktop reads them (desktop/src/shared/task-lines.ts and sync-ops.ts):
// indent, bullet (`-`, `*`, `+`, `1.` or `1)`), then `[ ]` / `[x]` / `[X]`.
const TASK = /^(\s*(?:[-*+]|\d+[.)]) +\[)([ xX])(\](?:\s|$))/;
const BOX = /^(\s*(?:[-*+]|\d+[.)]) +\[)[ xX](\])/;

/** A task line with its box blanked, so a ticked and an unticked line compare equal. */
export function taskText(line: string): string {
  return line.replace(BOX, "$1 $2");
}

/** The task on 0-based `line`: what `page.setTask` sends as `lineText`, and whether it is ticked. */
export function taskAt(body: string, line: number): { lineText: string; checked: boolean } | null {
  const text = body.split("\n")[line];
  const m = text === undefined ? null : TASK.exec(text);
  return m ? { lineText: taskText(text), checked: /[xX]/.test(m[2]) } : null;
}

function setTaskChecked(body: string, index: number, checked: boolean): string | null {
  const lines = body.split("\n");
  const line = lines[index];
  const m = line === undefined ? null : TASK.exec(line);
  if (!m) return null;
  if (/[xX]/.test(m[2]) === checked) return body;
  lines[index] = m[1] + (checked ? "x" : " ") + line.slice(m[1].length + 1);
  return lines.join("\n");
}

/** Ticks the task seen at `line`, found by its text if the lines moved; ambiguous or gone: unchanged. */
export function setTaskByText(body: string, line: number, lineText: string, checked: boolean): string {
  const lines = body.split("\n");
  let index = taskText(lines[line] ?? "") === lineText ? line : -1;
  if (index < 0) {
    const matches = lines.flatMap((l, i) => (taskText(l) === lineText ? [i] : []));
    if (matches.length !== 1) return body;
    index = matches[0];
  }
  return setTaskChecked(body, index, checked) ?? body;
}
