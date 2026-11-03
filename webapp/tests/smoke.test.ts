import { expect, it } from "vitest";
import type { PullRequest } from "@wire/sync/protocol";
import { PULL_PAGE_SIZE } from "../../desktop/src/shared/sync/protocol";

it("reaches the desktop's wire contract (types via @wire, runtime in tests)", () => {
  const req: PullRequest = { clientId: "w", cursor: 0 };
  expect(req.cursor).toBe(0);
  expect(PULL_PAGE_SIZE).toBe(500);
});
