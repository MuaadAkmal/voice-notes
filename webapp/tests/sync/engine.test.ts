import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PullResponse, PushRequest } from "@wire/sync/protocol";
import type { PageRow } from "@wire/sync-ops";
import { AuthExpired, Offline, Rejected } from "@/sync/client";
import { SyncEngine } from "@/sync/engine";
import { Outbox } from "@/sync/outbox";
import { WebStore } from "@/sync/store";

const page = (id: string, title = id): PageRow => ({ id, title, body: "", folderId: null, starred: false, createdAt: 1, updatedAt: 1 });
const rows = (from: number, n: number): PullResponse["rows"] =>
  Array.from({ length: n }, (_, i) => ({ entity: "page" as const, id: `p${from + i}`, version: from + i + 1, deleted: false, data: page(`p${from + i}`) }));
const empty = (cursor = 0): PullResponse => ({ cursor, hasMore: false, rows: [], prefs: [] });

type FakeClient = { pull: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn> };

function setup(client: FakeClient, refresh: () => Promise<"ok" | "signed-out" | "offline"> = async () => "ok") {
  const store = new WebStore();
  const outbox = new Outbox();
  const onSignedOut = vi.fn();
  const onRejected = vi.fn();
  const engine = new SyncEngine({ client: client as never, store, outbox, clientId: "W", deviceName: "Web · Chrome", refresh, onSignedOut, onRejected });
  return { store, outbox, engine, onSignedOut, onRejected };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("pulls page after page while hasMore", async () => {
  const pull = vi
    .fn()
    .mockResolvedValueOnce({ cursor: 500, hasMore: true, rows: rows(0, 500), prefs: [] })
    .mockResolvedValueOnce({ cursor: 1000, hasMore: true, rows: rows(500, 500), prefs: [] })
    .mockResolvedValueOnce({ cursor: 1020, hasMore: false, rows: rows(1000, 20), prefs: [] });
  const { store, engine } = setup({ pull, push: vi.fn() });
  await engine.syncNow();
  expect(store.snapshot().pages.size).toBe(1020);
  expect(store.snapshot().loaded).toBe(true);
  expect(pull.mock.calls.map((c) => c[0].cursor)).toEqual([0, 500, 1000]);
});

it("offline: says so and retries after 30 s, then 60 s", async () => {
  const pull = vi.fn().mockRejectedValue(new Offline());
  const { engine } = setup({ pull, push: vi.fn() });
  await engine.syncNow();
  expect(engine.status).toBe("offline");
  await vi.advanceTimersByTimeAsync(29_000);
  expect(pull).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(pull).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(pull).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(pull).toHaveBeenCalledTimes(3);
});

it("refreshes once on 401; a second 401 hands back the unsaved bodies", async () => {
  const push = vi.fn().mockRejectedValue(new AuthExpired());
  const refresh = vi.fn(async () => "ok" as const);
  const { engine, onSignedOut } = setup({ pull: vi.fn(), push }, refresh);
  engine.edit({ op: "page.setBody", id: "p", body: "draft" });
  engine.registerDraft("q", () => ({ body: "still typing", base: 4 }));
  await engine.syncNow();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledTimes(2);
  expect(onSignedOut).toHaveBeenCalledWith({ p: { body: "draft", base: 0 }, q: { body: "still typing", base: 4 } });
});

it("a refresh that fails for network reasons backs off instead of signing out", async () => {
  const pull = vi.fn().mockRejectedValue(new AuthExpired());
  const { engine, onSignedOut } = setup({ pull, push: vi.fn() }, async () => "offline");
  await engine.syncNow();
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(engine.status).toBe("offline");
});

it("a body saved from an open editor keeps the base it started from", async () => {
  const push = vi.fn(async (req: PushRequest) => ({ acked: req.mutations.map((m) => ({ id: m.id, version: 9 })) }));
  const pull = vi
    .fn()
    .mockResolvedValueOnce({ cursor: 6, hasMore: false, rows: [{ entity: "page", id: "p", version: 6, deleted: false, data: page("p") }], prefs: [] })
    .mockResolvedValue(empty(9));
  const { engine } = setup({ pull, push });
  await engine.syncNow();
  engine.edit({ op: "page.setBody", id: "p", body: "typed" }, { baseVersion: 5 });
  await engine.syncNow();
  expect(push.mock.calls[0][0].mutations[0].baseVersion).toBe(5);
});

it("a 401 that refreshes fine carries on", async () => {
  const pull = vi.fn().mockRejectedValueOnce(new AuthExpired()).mockResolvedValue(empty(3));
  const { engine, store } = setup({ pull, push: vi.fn() });
  await engine.syncNow();
  expect(store.snapshot().cursor).toBe(3);
  expect(engine.status).toBe("saved");
});

it("ignores its own pings and syncs on another device's", async () => {
  const pull = vi.fn().mockResolvedValue(empty());
  const { engine } = setup({ pull, push: vi.fn() });
  engine.ping("W");
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).not.toHaveBeenCalled();
  engine.ping("PC");
  await vi.advanceTimersByTimeAsync(0);
  expect(pull).toHaveBeenCalledTimes(1);
});

it("a rejected batch is dropped, reported, and the pull restores the server's row", async () => {
  const push = vi.fn().mockRejectedValue(new Rejected("Invalid change"));
  const pull = vi.fn().mockResolvedValue({ cursor: 2, hasMore: false, rows: [{ entity: "page", id: "a", version: 2, deleted: false, data: page("a", "Server") }], prefs: [] });
  const { engine, store, outbox, onRejected } = setup({ pull, push });
  engine.edit({ op: "page.update", id: "a", fields: { title: "Bad" } });
  await engine.syncNow();
  expect(onRejected).toHaveBeenCalledWith("Invalid change");
  expect(outbox.size).toBe(0);
  expect(store.snapshot().pages.get("a")?.data.title).toBe("Server");
});

it("sends an edit about a second later and records the acked version", async () => {
  const push = vi.fn(async (req: PushRequest) => ({ acked: req.mutations.map((m) => ({ id: m.id, version: 7 })) }));
  const pull = vi.fn().mockResolvedValue(empty(7));
  const { engine, store } = setup({ pull, push });
  await engine.syncNow();
  engine.edit({ op: "page.create", id: "n", row: page("n") });
  expect(engine.status).toBe("saving");
  await vi.advanceTimersByTimeAsync(999);
  expect(push).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(push).toHaveBeenCalledTimes(1);
  expect(push.mock.calls[0][0]).toMatchObject({ clientId: "W", deviceName: "Web · Chrome" });
  expect(store.version("page", "n")).toBe(7);
  expect(engine.status).toBe("saved");
});
