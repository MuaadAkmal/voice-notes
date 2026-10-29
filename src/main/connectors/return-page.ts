import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallbackResult } from '../../shared/connectors/protocol';

// The page the browser lands on after Google's consent. The `connectors` function sends it here
// (Edge Functions on *.supabase.co can't serve HTML), and its arrival tells the connect loop to ask
// how it went at once. Fixed copy only: the result word picks a page, nothing else is read.

const COPY: Record<CallbackResult, { heading: string; line: string }> = {
  connected: { heading: 'Google Calendar connected', line: 'You can close this tab and go back to Voice Notes.' },
  denied: { heading: 'Not connected', line: 'You cancelled at Google. You can try again from Voice Notes.' },
  'no-calendar': { heading: "Calendar access wasn't granted", line: 'Try again from Voice Notes and tick the calendar box.' },
  expired: { heading: 'This link has expired', line: 'Start again from Voice Notes.' },
  failed: { heading: 'Something went wrong', line: 'Try again from Voice Notes.' },
};

const CHECK = '<path d="M7 12.5l3.2 3.2L17 9" />';
const BANG = '<path d="M12 7.5v5.5" /><path d="M12 16.5h.01" />';

export function renderDonePage(result: CallbackResult): string {
  const { heading, line } = COPY[result];
  const ok = result === 'connected';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${heading} · Voice Notes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--bg:#f5f5f4;--card:#fff;--fg:#1c1917;--muted:#78716c;--border:#e7e5e4;--tint:${ok ? '#dcfce7' : '#fef3c7'};--ink:${ok ? '#15803d' : '#b45309'}}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--border:#292524;--tint:${ok ? '#14532d' : '#451a03'};--ink:${ok ? '#4ade80' : '#fbbf24'}}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);
font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--border);border-radius:16px;
padding:36px 32px 32px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px -12px rgba(0,0,0,.12)}
.app{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 24px}
.icon{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;display:grid;place-items:center;background:var(--tint);color:var(--ink)}
.icon svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
h1{font-size:20px;font-weight:600;margin:0 0 8px;letter-spacing:-.01em}
p.line{margin:0;color:var(--muted)}
</style></head>
<body><main class="card">
<p class="app">Voice Notes</p>
<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ok ? CHECK : BANG}</svg></div>
<h1>${heading}</h1>
<p class="line">${line}</p>
</main></body></html>`;
}

/**
 * A listener on 127.0.0.1 (never another interface) for `GET /connectors/done?result=…`. `arrived`
 * resolves on the first such request and never rejects. The page keeps being served (a reload, a
 * second tab) until the timeout, or for `graceMs` after the signal: the connect loop can learn the
 * outcome by polling a moment before the browser follows the redirect here, and must not leave it
 * facing a refused connection.
 */
export async function listenForReturn(opts: {
  timeoutMs: number;
  signal: AbortSignal;
  graceMs?: number;
}): Promise<{ port: number; arrived: Promise<void> }> {
  let arrive!: () => void;
  const arrived = new Promise<void>((r) => (arrive = r));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/connectors/done') {
      res.writeHead(404).end();
      return;
    }
    const word = url.searchParams.get('result') ?? '';
    const result: CallbackResult = Object.hasOwn(COPY, word) ? (word as CallbackResult) : 'failed';
    res
      .writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': 'no-store',
        Connection: 'close',
      })
      .end(renderDonePage(result));
    arrive();
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', linger);
    server.close();
    server.closeAllConnections();
  };
  let timer = setTimeout(close, opts.timeoutMs);
  const linger = () => {
    clearTimeout(timer);
    timer = setTimeout(close, opts.graceMs ?? 30_000);
  };
  opts.signal.addEventListener('abort', linger, { once: true });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  }).catch((err) => {
    close();
    throw err;
  });
  if (opts.signal.aborted) linger();
  return { port: (server.address() as AddressInfo).port, arrived };
}
