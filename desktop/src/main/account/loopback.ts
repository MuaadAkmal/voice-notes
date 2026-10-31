import http from 'node:http';
import type { AddressInfo } from 'node:net';

const page = (message: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Voice Notes</title>
<style>body{font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f6f3;color:#222}
@media(prefers-color-scheme:dark){body{background:#1f1f1f;color:#eee}}</style></head>
<body><p>${message}</p></body></html>`;

const SIGNED_IN = page("You're signed in to Voice Notes. You can close this tab.");
const CANCELLED = page('Sign-in was cancelled. You can close this tab.');
const FAILED = page("Sign-in didn't work. You can close this tab and try again.");

/**
 * A one-shot listener on 127.0.0.1 (never another interface) for the browser's redirect back from
 * Google via Supabase. Resolves the auth code; closes on every way out. The code is never echoed.
 */
export async function waitForRedirect(opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{
  url: string;
  result: Promise<{ code: string }>;
}> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  let settle!: { resolve: (v: { code: string }) => void; reject: (e: Error) => void };
  const result = new Promise<{ code: string }>((resolve, reject) => (settle = { resolve, reject }));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (req.method !== 'GET' || url.pathname !== '/callback' || (!code && !error)) {
      res.writeHead(404).end();
      return;
    }
    const reply = (html: string) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(html);
    if (code) {
      reply(SIGNED_IN);
      finish(() => settle.resolve({ code }));
    } else if (error === 'access_denied') {
      reply(CANCELLED);
      finish(() => settle.reject(new Error('Sign-in cancelled')));
    } else {
      reply(FAILED);
      finish(() => settle.reject(new Error(url.searchParams.get('error_description') || error || 'Sign-in failed')));
    }
  });

  let done = false;
  const timer = setTimeout(() => finish(() => settle.reject(new Error('Sign-in timed out'))), timeoutMs);
  const onAbort = () => finish(() => settle.reject(new Error('Cancelled')));
  opts.signal?.addEventListener('abort', onAbort);

  function finish(then: () => void): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    server.close();
    server.closeAllConnections();
    then();
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  if (opts.signal?.aborted) onAbort();
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/callback`, result };
}
