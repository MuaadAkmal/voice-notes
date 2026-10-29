import { type ConnectorsCore, NotConnected, Revoked } from './core.ts';
import type { CallbackResult } from './protocol.ts';

// The `connectors` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// The account always comes from the verified token, except on Google's redirect, where the one-time
// state says whose it is.

export type ConnectorsHandlerDeps = {
  /** The user for a valid access token, else null. */
  verify(jwt: string): Promise<{ userId: string; email: string | null } | null>;
  /** Null when a secret is missing: every route then says which. */
  core: Pick<ConnectorsCore, 'start' | 'callback' | 'attempt' | 'token' | 'disconnect' | 'status'> | null;
  missing: string[];
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PAGES: Record<CallbackResult, string> = {
  connected: 'Google Calendar is connected. You can go back to Voice Notes.',
  expired: 'This link has expired. Start again from Voice Notes.',
  denied: "Google Calendar wasn't connected.",
  'no-calendar': 'Calendar access wasn\'t granted. Try again from Voice Notes and tick the calendar box.',
  failed: 'Something went wrong. Try again from Voice Notes.',
};

// Fixed copy only: nothing from the request ever reaches the page.
const page = (result: CallbackResult) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Voice Notes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0 16px;color:#1c1917;background:#fafaf9}
@media (prefers-color-scheme:dark){body{color:#e7e5e4;background:#1c1917}}</style></head>
<body><p>${PAGES[result]}</p></body></html>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'no-store',
      },
    },
  );

export async function handleConnectors(req: Request, d: ConnectorsHandlerDeps): Promise<Response> {
  if (!d.core) {
    console.error('[connectors] missing secrets', d.missing.join(', '));
    return json(500, { error: 'misconfigured', missing: d.missing });
  }
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const last = parts[parts.length - 1];
  const route = parts[parts.length - 2] === 'google' ? `google/${last}` : last;
  const key = `${req.method} ${route}`;
  const routes = ['POST google/start', 'GET google/callback', 'GET google/attempt', 'GET google/token', 'POST google/disconnect', 'GET status'];
  if (!routes.includes(key)) return json(404, { error: 'Not found' });

  try {
    if (key === 'GET google/callback') {
      const q = url.searchParams;
      return page(
        await d.core.callback({
          code: q.get('code') ?? undefined,
          state: q.get('state') ?? undefined,
          error: q.get('error') ?? undefined,
        }),
      );
    }

    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const user = jwt ? await d.verify(jwt).catch(() => null) : null;
    if (!user) return json(401, { error: 'Sign in again' });

    if (key === 'POST google/start') return json(200, await d.core.start(user.userId, user.email));
    if (key === 'GET google/attempt') return json(200, await d.core.attempt(user.userId, url.searchParams.get('state') ?? ''));
    if (key === 'GET google/token') {
      try {
        return json(200, await d.core.token(user.userId));
      } catch (err) {
        if (err instanceof NotConnected) return json(404, { error: 'not-connected' });
        if (err instanceof Revoked) return json(409, { error: 'revoked' });
        throw err;
      }
    }
    if (key === 'POST google/disconnect') {
      await d.core.disconnect(user.userId);
      return new Response(null, { status: 204 });
    }
    return json(200, await d.core.status(user.userId));
  } catch (err) {
    console.error('[connectors]', key, err instanceof Error ? err.message : err);
    return json(500, { error: 'Server error' });
  }
}
