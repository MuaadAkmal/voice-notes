import { expect, it } from "vitest";
import { Rejected, SyncClient } from "@/sync/client";

it("a request the server finds too large is rejected, not retried", async () => {
  const fetch = (async () => new Response("{}", { status: 413 })) as unknown as typeof globalThis.fetch;
  const client = new SyncClient({ base: "https://x/sync", apikey: "k", token: async () => "t", fetch });
  await expect(client.push({ clientId: "W", deviceName: "Web", mutations: [] })).rejects.toBeInstanceOf(Rejected);
});
