import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { MemoryBucket } from '../../../src/shared/sync/file-bucket';
import { FileRules } from '../../../src/shared/sync/file-rules';
import { handle } from '../../../src/shared/sync/handler';
import { MemoryStore } from '../../../src/shared/sync/memory-store';
import type { FileKind } from '../../../src/shared/sync/protocol';
import { SyncCore } from '../../../src/shared/sync/server-core';

/**
 * The `sync` Edge Function's handler and rules over memory, on a local port: what two test apps
 * sync through. Every token belongs to one user. Signed file URLs point back here
 * (`PUT`/`GET /blob/<kind>/<path>`), standing in for Storage.
 */
export async function startSyncServer(userId: string): Promise<{ url: string; close(): Promise<void>; bucket: MemoryBucket }> {
  const store = new MemoryStore();
  const core = new SyncCore(store);
  let bucket = new MemoryBucket();
  let files = new FileRules(store, bucket);
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const blob = req.url?.match(/^\/blob\/(audio|image)\/(.+)$/);
    if (blob) {
      const [, kind, path] = blob as unknown as [string, FileKind, string];
      if (req.method === 'PUT') {
        bucket.put(kind, path, new Uint8Array(Buffer.concat(chunks)));
        res.writeHead(200).end('{}');
      } else {
        const bytes = bucket.get(kind, path);
        if (bytes) res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from(bytes));
        else res.writeHead(404).end();
      }
      return;
    }
    const request = new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const response = await handle(request, { verify: async () => userId, core, files });
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  bucket = new MemoryBucket(url);
  files = new FileRules(store, bucket);
  return {
    url,
    get bucket() {
      return bucket;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
