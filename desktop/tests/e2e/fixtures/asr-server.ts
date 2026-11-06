import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AsrCore, periodOf } from '../../../src/shared/asr/core';
import { handleAsr } from '../../../src/shared/asr/handler';
import { MemoryAsrStore } from '../../../src/shared/asr/store';
import { SpeakCore } from '../../../src/shared/asr/speak';
import { VoiceCore } from '../../../src/shared/asr/voice';

/**
 * The `asr` Edge Function's handler and rules over memory, on a local port, with a fake transcriber
 * (every clip is "hello world"): every token is `user`. `setUsed` sets this month's seconds, to drive
 * the quota case without recording two hours.
 */
export async function startAsrServer(user: { userId: string }): Promise<{
  url: string;
  /** Sets the seconds this month's usage stands at. */
  setUsed(seconds: number): Promise<void>;
  /** Puts the account on a plan (Free until then). */
  setPlan(plan: string, limit: number): void;
  /** Polished files the fake `speak` stored, by path (`<user>/<note>.polished.mp3`). */
  polished: Map<string, Uint8Array>;
  /** Forgets the clone, as a fresh account has none. */
  resetClone(): void;
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
  // Polished audio and voices over memory: the speaker answers a fixed one-second "mp3", the voice API clones at once.
  let base = '';
  const polished = new Map<string, Uint8Array>();
  let cloneId: string | null = null;
  const clones = {
    get: async () => cloneId,
    count: async () => (cloneId ? 1 : 0),
    put: async (_u: string, id: string) => {
      const old = cloneId;
      cloneId = id;
      return old;
    },
    remove: async () => {
      const old = cloneId;
      cloneId = null;
      return old;
    },
  };
  const voiceCore = new VoiceCore({
    store,
    clones,
    // Every voice previews with a few bytes served by this same server (main fetches it, and wants audio/*).
    api: { create: async () => 'fake-clone', remove: async () => {}, preview: async () => `${base}/sample.mp3` },
    limit: 5,
    now: Date.now,
  });
  const speak = new SpeakCore({
    store,
    speaker: async () => new Uint8Array(16000),
    files: { owns: async () => true, reserve: async () => true, upload: async (path, mp3) => void polished.set(path, mp3) },
    clone: voiceCore.usableClone,
    now: Date.now,
  });
  const deps = { verify: async () => user, core, speak, voice: voiceCore, missing: [] };

  const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/sample.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
      return;
    }
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
  base = `http://127.0.0.1:${port}`;
  return {
    url: `http://127.0.0.1:${port}`,
    setUsed: async (seconds) => {
      const { period } = periodOf(Date.now());
      const { used } = await store.usage(user.userId, period);
      if (seconds > used) await store.reserve(user.userId, period, seconds - used);
      else await store.refund(user.userId, period, used - seconds);
    },
    setPlan: (plan, limit) => store.setPlan(user.userId, plan, limit),
    polished,
    resetClone: () => {
      cloneId = null;
    },
    requests: (route) => seen.filter((s) => s.path.endsWith(route)).length,
    lastHeaders: (route) => seen.findLast((s) => s.path.endsWith(route))?.headers,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
