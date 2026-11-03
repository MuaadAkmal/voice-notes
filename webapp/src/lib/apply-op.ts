import type { PageRow, RowOp } from "@wire/sync-ops";
import { appendEntry } from "./learn-log";
import { setTaskByText } from "./task-lines";

/** The changes the web sends (no `page.appendLine`: that is the PCs' voice-to-lists). */
export type WebOp = Extract<
  RowOp,
  {
    op:
      | "note.update"
      | "note.delete"
      | "page.create"
      | "page.update"
      | "page.setBody"
      | "page.setTask"
      | "page.append"
      | "page.delete"
      | "folder.create"
      | "folder.update"
      | "folder.delete";
  }
>;

const stamp = (at: number | undefined) => (at === undefined ? {} : { updatedAt: at });

/** The row after `op` (the desktop's applyOp for these ops); undefined once deleted. */
export function applyWebOp<T>(row: T | undefined, op: WebOp): T | undefined {
  switch (op.op) {
    case "page.create":
    case "folder.create":
      return op.row as T;
    case "note.delete":
    case "page.delete":
    case "folder.delete":
      return undefined;
    case "note.update":
    case "page.update":
    case "folder.update":
      return row && { ...row, ...op.fields };
    case "page.setBody":
      return row && ({ ...row, body: op.body, ...stamp(op.at) } as T);
    case "page.append": {
      const page = row as PageRow | undefined;
      const [y, m, d] = op.day.split("-").map(Number);
      return page && ({ ...page, body: appendEntry(page.body, op.text, new Date(y, m - 1, d)), ...stamp(op.at) } as T);
    }
    case "page.setTask": {
      const page = row as PageRow | undefined;
      return page && ({ ...page, body: setTaskByText(page.body, op.line, op.lineText, op.checked), ...stamp(op.at) } as T);
    }
  }
}
