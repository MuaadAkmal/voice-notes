import { expect, it } from "vitest";
import * as desktop from "../../../desktop/src/shared/learn-log";
import { appendEntry, dayHeading, todayEntries } from "@/lib/learn-log";

const day = new Date(2026, 10, 3, 9, 30);
const bodies = [
  "",
  "intro",
  "intro\n",
  "intro\n\n",
  "## 2 Nov 2026\n- old\n",
  "## 3 Nov 2026\n- first\n",
  "## 3 Nov 2026\n- first\n\n\n",
  "## 3 Nov 2026\n- [ ] task\n- [x] done\n* star\nplain",
  "## 3 Nov 2026\n- a\n## Notes\n- b",
];

it("matches the desktop's day heading", () => {
  expect(dayHeading(day)).toBe(desktop.dayHeading(day));
  expect(dayHeading(day)).toBe("## 3 Nov 2026");
});

it.each(bodies)("appends like the desktop to %j", (body) => {
  expect(appendEntry(body, "  new\nline  ", day)).toBe(desktop.appendEntry(body, "  new\nline  ", day));
});

it.each(bodies)("reads today's entries like the desktop from %j", (body) => {
  expect(todayEntries(body, day)).toEqual(desktop.todayEntries(body, day));
});

it("refuses an empty entry", () => {
  expect(() => appendEntry("x", "   ", day)).toThrow();
});
