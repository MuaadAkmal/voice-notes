import { expect, it } from "vitest";
import type { PageRow } from "@wire/sync-ops";
import { handle } from "../../../desktop/src/shared/sync/handler";
import { MemoryStore } from "../../../desktop/src/shared/sync/memory-store";
import { SyncCore } from "../../../desktop/src/shared/sync/server-core";
import { SyncClient } from "@/sync/client";
import { SyncEngine } from "@/sync/engine";
import { Outbox } from "@/sync/outbox";
import { WebStore } from "@/sync/store";

// The web client against the real server rules (SyncCore over memory, behind the real handler).
const USER = "11111111-1111-4111-8111-111111111111";
const BASE = "https://x.supabase.co/functions/v1/sync";

function world() {
  const deps = { verify: async (jwt: string) => (jwt === "tok" ? USER : null), core: new SyncCore(new MemoryStore()) };
  const fetch = (async (url: string, init: RequestInit) => handle(new Request(url, init), deps)) as unknown as typeof globalThis.fetch;
  const client = () => new SyncClient({ base: BASE, apikey: "k", token: async () => "tok", fetch });
  const store = new WebStore();
  const web = new SyncEngine({ client: client(), store, outbox: new Outbox(), clientId: "W", deviceName: "Web · Chrome", refresh: async () => "ok" as const, onSignedOut: () => {} });
  const pc = client();
  let seq = 0;
  const pcPush = (op: object, baseVersion: number) =>
    pc.push({ clientId: "PC", deviceName: "PC-A", mutations: [{ id: `pc${seq++}`, op: op as never, baseVersion }] });
  const pcPages = async () =>
    (await pc.pull({ clientId: "PC", cursor: 0 })).rows.filter((r) => r.entity === "page" && !r.deleted).map((r) => r.data as PageRow);
  return { web, store, pcPush, pcPages };
}

const row = (body = "start"): PageRow => ({ id: "p", title: "P", body, folderId: null, starred: false, createdAt: 1, updatedAt: 1 });

it("web and PC edits converge", async () => {
  const { web, store, pcPush, pcPages } = world();
  await pcPush({ op: "page.create", id: "p", row: row() }, 0);
  await web.syncNow();
  expect(store.snapshot().pages.get("p")?.data.body).toBe("start");
  web.edit({ op: "page.update", id: "p", fields: { title: "From web", updatedAt: 2 } });
  await web.syncNow();
  expect((await pcPages()).find((p) => p.id === "p")?.title).toBe("From web");
  web.stop();
});

it("a PC body edit on an old base, after the web's, keeps a copy named after the web", async () => {
  const { web, store, pcPush, pcPages } = world();
  const { acked } = await pcPush({ op: "page.create", id: "p", row: row() }, 0);
  await web.syncNow();
  web.edit({ op: "page.setBody", id: "p", body: "web text" });
  await web.syncNow();
  await pcPush({ op: "page.setBody", id: "p", body: "pc text" }, acked[0].version);
  const pages = await pcPages();
  expect(pages.find((p) => p.id === "p")?.body).toBe("pc text");
  expect(pages.find((p) => p.title === "P (conflict, Web · Chrome)")?.body).toBe("web text");
  await web.syncNow();
  expect([...store.snapshot().pages.values()].map((p) => p.data.title).sort()).toEqual(["P", "P (conflict, Web · Chrome)"]);
  web.stop();
});

it("a PC append is replayed on top of a web body edit made without it", async () => {
  const { web, store, pcPush, pcPages } = world();
  await pcPush({ op: "page.create", id: "p", row: row("") }, 0);
  await web.syncNow();
  await pcPush({ op: "page.append", id: "p", text: "from pc", day: "2026-11-03" }, 0);
  web.edit({ op: "page.setBody", id: "p", body: "web text" });
  await web.syncNow();
  const body = (await pcPages()).find((p) => p.id === "p")!.body;
  expect(body.startsWith("web text")).toBe(true);
  expect(body).toContain("from pc");
  expect(store.snapshot().pages.get("p")?.data.body).toBe(body);
  web.stop();
});

it("a delete wins over a later web edit", async () => {
  const { web, store, pcPush, pcPages } = world();
  const { acked } = await pcPush({ op: "page.create", id: "p", row: row() }, 0);
  await web.syncNow();
  await pcPush({ op: "page.delete", id: "p" }, acked[0].version);
  web.edit({ op: "page.update", id: "p", fields: { title: "Too late" } });
  await web.syncNow();
  expect(await pcPages()).toEqual([]);
  expect(store.snapshot().pages.has("p")).toBe(false);
  web.stop();
});

it("an append made while the web editor is open survives the editor's save", async () => {
  const { web, store, pcPush, pcPages } = world();
  await pcPush({ op: "page.create", id: "p", row: row("") }, 0);
  await web.syncNow();
  const seededAt = store.version("page", "p"); // the editor opens here
  await pcPush({ op: "page.append", id: "p", text: "from pc", day: "2026-11-03" }, 0);
  await web.syncNow(); // a ping brings the append into the store, not into the editor
  web.edit({ op: "page.setBody", id: "p", body: "web text" }, { baseVersion: seededAt });
  await web.syncNow();
  const body = (await pcPages()).find((p) => p.id === "p")!.body;
  expect(body.startsWith("web text")).toBe(true);
  expect(body).toContain("from pc");
  web.stop();
});

it("a new page typed into before its create is acked makes no conflict copy", async () => {
  const { web, pcPages } = world();
  web.edit({ op: "page.create", id: "n", row: { ...row(""), id: "n", title: "New" } });
  const sent = web.syncNow(); // the create is in flight
  web.edit({ op: "page.setBody", id: "n", body: "hello" });
  await sent;
  await web.syncNow();
  const pages = await pcPages();
  expect(pages.map((p) => p.title)).toEqual(["New"]);
  expect(pages[0].body).toBe("hello");
  web.stop();
});

it("a web quick-add and a later PC body edit on an older base both survive", async () => {
  const { web, pcPush, pcPages } = world();
  const { acked } = await pcPush({ op: "page.create", id: "p", row: row("pc start") }, 0);
  await web.syncNow();
  web.edit({ op: "page.append", id: "p", text: "from web", day: "2026-11-03", at: 5 });
  await web.syncNow();
  await pcPush({ op: "page.setBody", id: "p", body: "pc edited" }, acked[0].version);
  const body = (await pcPages()).find((p) => p.id === "p")!.body;
  expect(body.startsWith("pc edited")).toBe(true);
  expect(body).toContain("- from web");
  web.stop();
});
