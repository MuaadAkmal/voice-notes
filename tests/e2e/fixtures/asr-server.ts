import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AsrCore, periodOf } from '../../../src/shared/asr/core';
import { handleAsr } from '../../../src/shared/asr/handler';
import { MemoryAsrStore } from '../../../src/shared/asr/store';

/**
 * The `asr` Edge Function's handler and rules over memory, on a local port, with a fake transcriber
 * (every clip is "hello world"): every token is `user`. `setUsed` sets this month's seconds, to drive
 * the quota case without recording two hours.
 */
export async function startAsrServer(user: { userId: string }): Promise<{
  url: string;
  /** Sets the seconds this month's usage stands at. */
  setUsed(seconds: number): Promise<void>;
  /** How many requests reached a path ending in `route` ('transcribe', 'usage'). */
  requests(route: string): number;
  /** Header values of the last request that reached `route`. */
  lastHeaders(route: string): http.IncomingHttpHeaders | undefined;
  close(): Promise<void>;
}> {
  const store = new MemoryAsrStore();
  const core = new AsrCore({
    store,
    transcribe: async () => ({ text: ' hello world', language: 'en' }),
    now: Date.now,
  });
  const deps = { verify: async () => user, core, missing: [] };

  const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer(async (req, res) => {
    seen.push({ path: new URL(req.url ?? '/', 'http://x').pathname, headers: req.headers });
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await handleAsr(
      new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body }),
      deps,
    );
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json' });
    res.end(await response.text());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    setUsed: async (seconds) => {
      const { period } = periodOf(Date.now());
      const { used } = await store.usage(user.userId, period);
      if (seconds > used) await store.reserve(user.userId, period, seconds - used);
      else await store.refund(user.userId, period, used - seconds);
    },
    requests: (route) => seen.filter((s) => s.path.endsWith(route)).length,
    lastHeaders: (route) => seen.findLast((s) => s.path.endsWith(route))?.headers,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
