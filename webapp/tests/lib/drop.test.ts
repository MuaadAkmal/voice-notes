import { expect, it, vi } from "vitest";
import { dropOnto } from "@/lib/drop";

const event = (payload: string | null) => ({
  dataTransfer: { types: payload ? ["application/x-vn-item"] : [], getData: () => payload ?? "" },
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

it("a drop onto a folder stops there, so the root target under it doesn't move the item back", () => {
  const move = vi.fn();
  const e = event(JSON.stringify({ kind: "page", id: "p" }));
  dropOnto(e, "f", move);
  expect(move).toHaveBeenCalledWith("page", "p", "f");
  expect(e.stopPropagation).toHaveBeenCalled();
});

it("ignores drags that aren't ours, and a folder dropped on itself", () => {
  const move = vi.fn();
  const foreign = event(null);
  dropOnto(foreign, "f", move);
  expect(foreign.stopPropagation).not.toHaveBeenCalled();
  dropOnto(event(JSON.stringify({ kind: "folder", id: "f" })), "f", move);
  expect(move).not.toHaveBeenCalled();
});
