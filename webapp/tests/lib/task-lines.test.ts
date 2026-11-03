import { expect, it } from "vitest";
import { setTaskByText, taskAt } from "@/lib/task-lines";

const body = "a\n- [ ] x\n- [x] y";

it("reads a task line with its box blanked", () => {
  expect(taskAt(body, 1)).toEqual({ lineText: "- [ ] x", checked: false });
  expect(taskAt(body, 2)).toEqual({ lineText: "- [ ] y", checked: true });
  expect(taskAt(body, 0)).toBeNull();
  expect(taskAt(body, 9)).toBeNull();
});

it("ticks by text when the line moved, and leaves an ambiguous body alone", () => {
  expect(setTaskByText("new\n" + body, 1, "- [ ] x", true)).toBe("new\na\n- [x] x\n- [x] y");
  expect(setTaskByText("- [ ] x\n- [ ] x", 5, "- [ ] x", true)).toBe("- [ ] x\n- [ ] x");
});
