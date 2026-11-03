// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Markdown } from "@/components/page/Markdown";

afterEach(cleanup);

it("renders script links and raw HTML inert", () => {
  const { container } = render(<Markdown body={'[x](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">'} />);
  const a = container.querySelector("a");
  expect(a?.getAttribute("href") ?? "").not.toContain("javascript");
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});

it("a task checkbox ticks its own source line", () => {
  const onTick = vi.fn();
  const { container } = render(<Markdown body={"a\n\n- [ ] b\n- [x] c"} onTick={onTick} />);
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  fireEvent.click(boxes[0]);
  expect(onTick).toHaveBeenCalledWith(2, true);
  fireEvent.click(boxes[1]);
  expect(onTick).toHaveBeenCalledWith(3, false);
});

it("page images go through imageFor; other links open in a new tab", () => {
  const imageFor = vi.fn((name: string) => <span data-testid="img">{name}</span>);
  const name = "0b1e7f4e-1111-4111-8111-111111111111.png";
  const { getByTestId, container } = render(<Markdown body={`![shot](vn-image://${name})\n\n[site](https://example.com)`} imageFor={imageFor} />);
  expect(imageFor).toHaveBeenCalledWith(name, "shot");
  expect(getByTestId("img").textContent).toBe(name);
  const link = container.querySelector('a[href="https://example.com"]');
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toContain("noreferrer");
});
