import { expect, it } from 'vitest';
import { BadRequest, LimitReached } from '../../../src/shared/commands/core';
import { LlmFailed } from '../../../src/shared/commands/groq';
import { type CommandsHandlerDeps, handleCommands } from '../../../src/shared/commands/handler';
import type { ResolveResponse } from '../../../src/shared/commands/protocol';

const URL_ = 'https://x.supabase.co/functions/v1/commands/resolve';
const OK: ResolveResponse = { action: 'append', pageId: 'g', items: ['milk'] };

const deps = (resolve: (u: string, b: unknown) => Promise<ResolveResponse>): CommandsHandlerDeps => ({
  verify: async (jwt) => (jwt === 'good' ? { userId: 'u1' } : null),
  core: { resolve },
  missing: [],
});

const post = (body: string, token = 'good', url = URL_) =>
  new Request(url, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body });

it('resolves for the verified user', async () => {
  let seen: [string, unknown] | null = null;
  const res = await handleCommands(post('{"text":"milk","pages":[]}'), deps(async (u, b) => ((seen = [u, b]), OK)));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(OK);
  expect(seen).toEqual(['u1', { text: 'milk', pages: [] }]);
});

it('needs a valid token', async () => {
  expect((await handleCommands(post('{}', ''), deps(async () => OK))).status).toBe(401);
  expect((await handleCommands(post('{}', 'bad'), deps(async () => OK))).status).toBe(401);
});

it('only serves POST resolve', async () => {
  expect((await handleCommands(new Request(URL_), deps(async () => OK))).status).toBe(404);
  expect((await handleCommands(post('{}', 'good', URL_.replace('resolve', 'other')), deps(async () => OK))).status).toBe(404);
});

it('maps failures to status codes without internals', async () => {
  const status = async (err: Error) => {
    const res = await handleCommands(post('{}'), deps(async () => { throw err; }));
    return [res.status, (await res.json()).error];
  };
  expect(await status(new BadRequest('text'))).toEqual([400, 'bad-request']);
  expect(await status(new LimitReached())).toEqual([429, 'limit']);
  expect(await status(new LlmFailed('Groq 500'))).toEqual([502, 'llm']);
  expect(await status(new Error('db password wrong'))).toEqual([500, 'Server error']);
});

it('refuses bad JSON and oversized bodies', async () => {
  expect((await handleCommands(post('{'), deps(async () => OK))).status).toBe(400);
  expect((await handleCommands(post('x'.repeat(70_000)), deps(async () => OK))).status).toBe(413);
});

it('says which secret is missing', async () => {
  const res = await handleCommands(post('{}'), { verify: async () => null, core: null, missing: ['GROQ_API_KEY'] });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'misconfigured', missing: ['GROQ_API_KEY'] });
});
