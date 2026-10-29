import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConnectorsCore } from '../../../src/shared/connectors/core';
import { handleConnectors } from '../../../src/shared/connectors/handler';
import { MemoryConnectorStore } from '../../../src/shared/connectors/memory-store';
import { CALENDAR_SCOPE } from '../../../src/shared/connectors/protocol';

/**
 * The `connectors` Edge Function's handler and rules over memory, on a local port, with a fake Google:
 * every token is `user`, and `connect(email)` plays the browser coming back from consent. The Calendar
 * API is served under /calendar/v3: the events list answers `events`, and adding (insert or Quick Add,
 * which titles its event with the text, today 13:00–14:00) appends to it.
 */
export async function startConnectorsServer(
  user: { userId: string; email: string },
  events: unknown[],
): Promise<{
  url: string;
  /** Returns the app's loopback port the browser would be sent on to (null: none). */
  connect(email: string): Promise<number | null>;
  requests(route: string): number;
  close(): Promise<void>;
}> {
  let consentEmail = '';
  let lastState = '';
  let n = 0;
  const core = new ConnectorsCore({
    store: new MemoryConnectorStore(),
    google: {
      exchange: async () => ({
        refreshToken: 'r',
        scope: `openid email ${CALENDAR_SCOPE}`,
        idToken: `h.${Buffer.from(JSON.stringify({ email: consentEmail })).toString('base64url')}.s`,
      }),
      refresh: async () => ({ accessToken: 'at', expiresIn: 3600 }),
      revoke: async () => undefined,
    },
    cipher: { encrypt: async (s) => s, decrypt: async (s) => s },
    clientId: 'test-client',
    redirectUri: 'http://127.0.0.1/functions/v1/connectors/google/callback',
    now: Date.now,
    randomState: () => (lastState = `state${++n}`),
  });
  const deps = { verify: async () => user, core, missing: [] };

  const seen: string[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    seen.push(url.pathname);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
    const reply = (item: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(item));
    if (url.pathname === '/calendar/v3/calendars/primary/events/quickAdd' && req.method === 'POST') {
      const at = (h: number) => {
        const d = new Date();
        d.setHours(h, 0, 0, 0);
        return d.toISOString();
      };
      const added = { id: `q${++n}`, summary: url.searchParams.get('text'), htmlLink: `https://www.google.com/calendar/event?eid=q${n}`, start: { dateTime: at(13) }, end: { dateTime: at(14) } };
      events.push(added);
      return reply(added);
    }
    if (url.pathname === '/calendar/v3/calendars/primary/events' && req.method === 'POST') {
      const e = JSON.parse(body ?? '{}') as { summary: string; start: unknown; end: unknown };
      const added = { id: `c${++n}`, summary: e.summary, htmlLink: `https://www.google.com/calendar/event?eid=c${n}`, start: e.start, end: e.end };
      events.push(added);
      return reply(added);
    }
    if (url.pathname.startsWith('/calendar/v3/calendars/primary/events')) return reply({ items: events });
    const response = await handleConnectors(
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
    connect: async (email) => {
      consentEmail = email;
      const { result, returnPort } = await core.callback({ code: 'c', state: lastState });
      if (result !== 'connected') throw new Error(`consent ended as ${result}`);
      return returnPort;
    },
    /** How many requests reached a path ending in `route` (e.g. 'google/token'). */
    requests: (route) => seen.filter((p) => p.endsWith(route)).length,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
