import { describe, expect, it } from "vitest";
import { applyOp } from "../../../desktop/src/shared/sync-ops";
import type { FolderRow, NoteRow, PageRow } from "@wire/sync-ops";
import { applyWebOp, type WebOp } from "@/lib/apply-op";

const page: PageRow = { id: "p", title: "P", body: "# T\n- [ ] a\n- [x] b\n- [ ] a", folderId: null, starred: false, createdAt: 1, updatedAt: 1 };
const note = { id: "n", title: "N", folderId: null, starred: false, transcript: null, updatedAt: 1 } as unknown as NoteRow;
const folder: FolderRow = { id: "f", name: "F", parentId: null, createdAt: 1, updatedAt: 1 };

const cases: [string, unknown, WebOp][] = [
  ["page.create", undefined, { op: "page.create", id: "p", row: page }],
  ["page.update", page, { op: "page.update", id: "p", fields: { title: "Q", starred: true, updatedAt: 5 } }],
  ["page.setBody", page, { op: "page.setBody", id: "p", body: "new *as typed*  \n", at: 9 }],
  ["page.setTask", page, { op: "page.setTask", id: "p", line: 2, lineText: "- [ ] b", checked: false, at: 9 }],
  ["page.setTask shifted", page, { op: "page.setTask", id: "p", line: 0, lineText: "- [ ] b", checked: false }],
  ["page.setTask ambiguous", page, { op: "page.setTask", id: "p", line: 0, lineText: "- [ ] a", checked: true }],
  ["page.append", page, { op: "page.append", id: "p", text: "learned", day: "2026-11-03", at: 9 }],
  ["page.append new day", { ...page, body: "" }, { op: "page.append", id: "p", text: "x", day: "2026-01-31" }],
  ["page.delete", page, { op: "page.delete", id: "p" }],
  ["note.update", note, { op: "note.update", id: "n", fields: { transcript: "hi", folderId: "f", updatedAt: 3 } }],
  ["note.delete", note, { op: "note.delete", id: "n" }],
  ["folder.create", undefined, { op: "folder.create", id: "f", row: folder }],
  ["folder.update", folder, { op: "folder.update", id: "f", fields: { name: "G", parentId: "x" } }],
  ["folder.delete", folder, { op: "folder.delete", id: "f" }],
];

describe("applyWebOp matches the desktop's applyOp", () => {
  it.each(cases)("%s", (_name, row, op) => {
    expect(applyWebOp(row, op)).toEqual(applyOp(row, op));
  });
});
