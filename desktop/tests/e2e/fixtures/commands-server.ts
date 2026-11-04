import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommandsCore } from '../../../src/shared/commands/core';
import { handleCommands } from '../../../src/shared/commands/handler';
import { MemoryUsageStore } from '../../../src/shared/commands/store';
import { TitleCore } from '../../../src/shared/commands/title';

/**
 * The `commands` Edge Function's handler over memory, on a local port, with a fake LLM that titles
 * every note `title` (and files no command). Every token is `user`.
 */
export async function startCommandsServer(user: { userId: string }, title = 'Shopping list'): Promise<{
  url: string;
  /** Requests that reached a path ending in `route`, with their JSON bodies. */
  bodies(route: string): unknown[];
  close(): Promise<void>;
}> {
  const chat = async () => JSON.stringify({ title, page: null, items: [] });
  const deps = {
    verify: async () => user,
    core: new CommandsCore({ chat, usage: new MemoryUsageStore(), dailyLimit: 200, now: Date.now }),
    title: new TitleCore({ chat, usage: new MemoryUsageStore(), dailyLimit: 300, now: Date.now }),
    missing: [],
  };
  const seen: { path: string; body: unknown }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    seen.push({ path, body: text ? JSON.parse(text) : null });
    const response = await handleCommands(
      new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: text || undefined }),
      deps,
    );
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    bodies: (route) => seen.filter((s) => s.path.endsWith(route)).map((s) => s.body),
    close: () => new Promise((r) => server.close(() => r())),
  };
}
