import { expect, it } from "vitest";
import { searchAll } from "@/lib/search";

const pages = [
  { id: "p1", title: "Café notes", body: "nothing" },
  { id: "p2", title: "Other", body: "we met at the cafe today" },
];
const notes = [{ id: "n1", title: "Voice", transcript: "remember the CAFÉ order", show: null }];

it("finds accent-insensitively, titles first", () => {
  const hits = searchAll({ pages, notes }, "cafe");
  expect(hits.map((h) => h.id)).toEqual(["p1", "p2", "n1"]);
  expect(hits[2].kind).toBe("note");
});

it("an empty query finds nothing", () => {
  expect(searchAll({ pages, notes }, "  ")).toEqual([]);
});
