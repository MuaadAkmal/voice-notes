import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle } from '../../../src/shared/sync/handler';
import { MemoryStore } from '../../../src/shared/sync/memory-store';
import { SyncCore } from '../../../src/shared/sync/server-core';

/**
 * The `sync` Edge Function's handler and rules over memory, on a local port: what two test apps
 * sync through. Every token belongs to one user.
 */
export async function startSyncServer(userId: string): Promise<{ url: string; close(): Promise<void> }> {
  const core = new SyncCore(new MemoryStore());
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const response = await handle(request, { verify: async () => userId, core });
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
