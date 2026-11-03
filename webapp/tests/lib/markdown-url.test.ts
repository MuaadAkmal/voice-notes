import { expect, it } from "vitest";
import { safeUrl } from "@/lib/markdown-url";

it("drops script and data urls", () => {
  expect(safeUrl("javascript:alert(1)")).toBe("");
  expect(safeUrl("JaVaScRiPt:x")).toBe("");
  expect(safeUrl(" javascript:x")).toBe("");
  expect(safeUrl("data:text/html,x")).toBe("");
  expect(safeUrl("vbscript:x")).toBe("");
});

it("keeps web, mail, vn-image and relative links", () => {
  expect(safeUrl("https://a.b/c?d")).toBe("https://a.b/c?d");
  expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
  expect(safeUrl("vn-image://0b1e7f4e-1111-4111-8111-111111111111.png")).toBe("vn-image://0b1e7f4e-1111-4111-8111-111111111111.png");
  expect(safeUrl("#heading")).toBe("#heading");
});
