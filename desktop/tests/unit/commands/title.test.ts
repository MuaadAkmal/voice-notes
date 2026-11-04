import { describe, expect, it } from 'vitest';
import { BadRequest, LimitReached } from '../../../src/shared/commands/core';
import { handleCommands } from '../../../src/shared/commands/handler';
import { MemoryUsageStore } from '../../../src/shared/commands/store';
import { MAX_TITLE_TEXT, readTitle, TITLE_PROMPT, TitleCore } from '../../../src/shared/commands/title';

const reply = (title: unknown) => JSON.stringify({ title });

describe('readTitle', () => {
  it('trims, unquotes and drops a trailing period', () => {
    expect(readTitle(reply('  "Groceries for Sunday." '))).toBe('Groceries for Sunday');
    expect(readTitle(reply('“Call the bank”'))).toBe('Call the bank');
  });

  it('collapses whitespace and line breaks', () => {
    expect(readTitle(reply('Plan\n  the   trip'))).toBe('Plan the trip');
  });

  it.each([
    ['empty', ''],
    ['over 10 words', 'word '.repeat(11)],
    ['over 80 characters', 'x'.repeat(81)],
    ['not a string', 5],
  ])('refuses %s', (_, title) => {
    expect(readTitle(reply(title))).toBeNull();
  });

  it.each(['not json', 'null', '[]'])('refuses the reply %s', (content) => {
    expect(readTitle(content)).toBeNull();
  });
});

const core = (o: { content?: string; limit?: number; seen?: { system: string; user: string }[] } = {}) =>
  new TitleCore({
    chat: async (system, user) => {
      o.seen?.push({ system, user });
      return o.content ?? reply('Shopping list');
    },
    usage: new MemoryUsageStore(),
    dailyLimit: o.limit ?? 300,
    now: () => Date.parse('2026-11-04T10:00:00Z'),
  });

describe('TitleCore', () => {
  it('asks the LLM with the title prompt and the transcript as data', async () => {
    const seen: { system: string; user: string }[] = [];
    expect(await core({ seen }).title('u1', { text: 'buy milk and eggs' })).toEqual({ title: 'Shopping list' });
    expect(seen).toEqual([{ system: TITLE_PROMPT, user: JSON.stringify({ transcript: 'buy milk and eggs' }) }]);
  });

  it('answers null for a reply it cannot use', async () => {
    expect(await core({ content: 'oops' }).title('u1', { text: 'buy milk' })).toEqual({ title: null });
  });

  it.each([{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(MAX_TITLE_TEXT + 1) }, null])('refuses %j', async (body) => {
    await expect(core().title('u1', body)).rejects.toBeInstanceOf(BadRequest);
  });

  it('refuses past the daily cap', async () => {
    const c = core({ limit: 1 });
    await c.title('u1', { text: 'one' });
    await expect(c.title('u1', { text: 'two' })).rejects.toBeInstanceOf(LimitReached);
  });
});

describe('the title route', () => {
  const deps = (title?: { title: (u: string, b: unknown) => Promise<{ title: string | null }> }) => ({
    verify: async (jwt: string) => (jwt === 'good' ? { userId: 'u1' } : null),
    core: { resolve: async () => ({ action: 'none' as const, reason: 'unclear' as const }), remind: async () => ({ action: 'none' as const }) },
    title,
    missing: [],
  });
  const post = (body: string) =>
    new Request('https://x.supabase.co/functions/v1/commands/title', { method: 'POST', headers: { authorization: 'Bearer good' }, body });

  it('titles for the verified user', async () => {
    let user = '';
    const res = await handleCommands(post('{"text":"hi there you"}'), deps({ title: async (u) => ((user = u), { title: 'Hi' }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: 'Hi' });
    expect(user).toBe('u1');
  });

  it('is not found when the function has no title core', async () => {
    expect((await handleCommands(post('{"text":"x"}'), deps())).status).toBe(404);
  });

  it('says 429 past the cap', async () => {
    const res = await handleCommands(post('{"text":"x"}'), deps({ title: async () => { throw new LimitReached(); } }));
    expect(res.status).toBe(429);
  });
});
