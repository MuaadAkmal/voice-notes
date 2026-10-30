import { BadRequest, type CommandsCore, LimitReached } from './core.ts';
import { LlmFailed } from './groq.ts';

// The `commands` Edge Function's request handling, kept free of Deno so it is unit-tested in Node.
// The account always comes from the verified token. Errors say what kind, never the internals.

export type CommandsHandlerDeps = {
  /** The user for a valid access token, else null. */
  verify(jwt: string): Promise<{ userId: string } | null>;
  /** Null when a secret is missing. */
  core: Pick<CommandsCore, 'resolve'> | null;
  missing: string[];
};

const MAX_BODY = 64 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleCommands(req: Request, d: CommandsHandlerDeps): Promise<Response> {
  if (!d.core) {
    console.error('[commands] missing secrets', d.missing.join(', '));
    return json(500, { error: 'misconfigured', missing: d.missing });
  }
  const route = new URL(req.url).pathname.split('/').pop();
  if (req.method !== 'POST' || route !== 'resolve') return json(404, { error: 'Not found' });

  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = jwt ? await d.verify(jwt).catch(() => null) : null;
  if (!user) return json(401, { error: 'Sign in again' });

  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad-request' });
  }

  try {
    return json(200, await d.core.resolve(user.userId, body));
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: 'bad-request' });
    if (err instanceof LimitReached) return json(429, { error: 'limit' });
    if (err instanceof LlmFailed) {
      console.error('[commands] llm', err.message);
      return json(502, { error: 'llm' });
    }
    console.error('[commands]', err instanceof Error ? err.message : err);
    return json(500, { error: 'Server error' });
  }
}
