import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConnectorsCore } from '../../../src/shared/connectors/core';
import { handleConnectors } from '../../../src/shared/connectors/handler';
import { MemoryConnectorStore } from '../../../src/shared/connectors/memory-store';
import { CALENDAR_SCOPE } from '../../../src/shared/connectors/protocol';

/**
 * The `connectors` Edge Function's handler and rules over memory, on a local port, with a fake Google:
 * every token is `user`, and `connect(email)` plays the browser coming back from consent. The Calendar
 * API's events list is served under /calendar/v3, answering `events`.
 */
export async function startConnectorsServer(
  user: { userId: string; email: string },
  events: unknown[],
): Promise<{ url: string; connect(email: string): Promise<void>; close(): Promise<void> }> {
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

  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/calendar/v3/calendars/primary/events')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: events }));
      return;
    }
    const response = await handleConnectors(
      new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string> }),
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
      const page = await core.callback({ code: 'c', state: lastState });
      if (page !== 'connected') throw new Error(`consent ended as ${page}`);
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
