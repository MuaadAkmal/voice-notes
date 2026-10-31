import { expect, it, vi } from 'vitest';
import { CommandsCore, HERE_RULE, LimitReached, readReply, SYSTEM_PROMPT } from '../../../src/shared/commands/core';
import { groqChat, LlmFailed } from '../../../src/shared/commands/groq';
import { MemoryUsageStore } from '../../../src/shared/commands/store';

const PAGES = [
  { id: 'g', title: 'Groceries' },
  { id: 'a', title: 'Arabic phrases' },
  { id: 'y', title: 'YouTube watch list' },
];
const NOW = Date.UTC(2026, 9, 29, 12);

const core = (reply: string, dailyLimit = 200) => {
  const chat = vi.fn(async () => reply);
  return { chat, core: new CommandsCore({ chat, usage: new MemoryUsageStore(), dailyLimit, now: () => NOW }) };
};

it('sends numbered titles and the command, and maps the page number back to its id', async () => {
  const { chat, core: c } = core('{"page": 1, "items": ["blueberry"]}');
  expect(await c.resolve('u', { text: 'add blueberry to my grocery list', pages: PAGES })).toEqual({
    action: 'append',
    pageId: 'g',
    items: ['blueberry'],
  });
  expect(chat).toHaveBeenCalledWith(SYSTEM_PROMPT, JSON.stringify({
    pages: ['1. Groceries', '2. Arabic phrases', '3. YouTube watch list'],
    command: 'add blueberry to my grocery list',
  }));
});

it('keeps Arabic items as they are', async () => {
  const { core: c } = core('{"page": 2, "items": ["كيف الحال يا صديقي؟"]}');
  expect(await c.resolve('u', { text: 'new phrase كيف الحال يا صديقي؟', pages: PAGES })).toEqual({
    action: 'append',
    pageId: 'a',
    items: ['كيف الحال يا صديقي؟'],
  });
});

it('refuses bad requests before calling the LLM', async () => {
  const { chat, core: c } = core('{}');
  await expect(c.resolve('u', { text: ' ', pages: PAGES })).rejects.toThrow();
  await expect(c.resolve('u', { text: 'x'.repeat(501), pages: PAGES })).rejects.toThrow();
  await expect(c.resolve('u', { text: 'milk', pages: [] })).rejects.toThrow();
  await expect(c.resolve('u', { text: 'milk', pages: [{ id: 1, title: 'x' }] })).rejects.toThrow();
  await expect(c.resolve('u', null)).rejects.toThrow();
  expect(chat).not.toHaveBeenCalled();
});

it('stops at the daily limit, per account', async () => {
  const { core: c } = core('{"page": 1, "items": ["x"]}', 2);
  await c.resolve('u', { text: 'x', pages: PAGES });
  await c.resolve('u', { text: 'x', pages: PAGES });
  await expect(c.resolve('u', { text: 'x', pages: PAGES })).rejects.toBeInstanceOf(LimitReached);
  await expect(c.resolve('other', { text: 'x', pages: PAGES })).resolves.toMatchObject({ action: 'append' });
});

it('turns any reply that is not one of our pages plus items into none', () => {
  expect(readReply('{"page": null, "items": []}', PAGES)).toEqual({ action: 'none', reason: 'no-match' });
  expect(readReply('{"page": null, "items": ["call the bank"]}', PAGES)).toEqual({ action: 'none', reason: 'no-match', items: ['call the bank'] });
  expect(readReply('not json', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('{"page": 4, "items": ["x"]}', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('{"page": "1", "items": ["x"]}', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('{"page": 1.5, "items": ["x"]}', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('{"page": 1, "items": []}', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('{"page": 1, "items": ["   "]}', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply(`{"page": 1, "items": ["${'x'.repeat(201)}"]}`, PAGES)).toEqual({ action: 'none', reason: 'unclear' });
  expect(readReply('null', PAGES)).toEqual({ action: 'none', reason: 'unclear' });
});

it('tidies items: trimmed, one line each, non-strings dropped', () => {
  expect(readReply('{"page": 1, "items": [" milk ", "eggs\\nand more", 3, "bread"]}', PAGES)).toEqual({
    action: 'append',
    pageId: 'g',
    items: ['milk', 'eggs and more', 'bread'],
  });
});

it('groqChat asks for JSON and returns the message content', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"page":1}' } }] })));
  const chat = groqChat({ apiKey: 'k', model: 'm', fetch: fetch as never });
  expect(await chat('sys', 'usr')).toBe('{"page":1}');
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm', temperature: 0, response_format: { type: 'json_object' } });
});

it('groqChat fails on HTTP errors, network errors and empty replies', async () => {
  const chat = (f: () => Promise<Response>) => groqChat({ apiKey: 'k', model: 'm', fetch: f as never })('s', 'u');
  await expect(chat(async () => new Response('nope', { status: 500 }))).rejects.toBeInstanceOf(LlmFailed);
  await expect(chat(async () => { throw new TypeError('offline'); })).rejects.toBeInstanceOf(LlmFailed);
  await expect(chat(async () => new Response('{"choices": []}'))).rejects.toBeInstanceOf(LlmFailed);
});

it('counts while the LLM answers, and still refuses past the cap', async () => {
  const order: string[] = [];
  let release!: () => void;
  const usage = { increment: () => new Promise<number>((r) => (release = () => r(3))).finally(() => order.push('counted')) };
  const chat = vi.fn(async () => (order.push('answered'), '{"page": 1, "items": ["x"]}'));
  const c = new CommandsCore({ chat, usage, dailyLimit: 2, now: () => NOW });
  const result = c.resolve('u', { text: 'x', pages: PAGES });
  await vi.waitFor(() => expect(chat).toHaveBeenCalled()); // asked before the count came back
  release();
  await expect(result).rejects.toBeInstanceOf(LimitReached);
  expect(order).toEqual(['answered', 'counted']);
});

it('with here, adds the @this rule and the flag', async () => {
  const { chat, core: c } = core('{"page": 3, "items": ["@this"]}');
  expect(await c.resolve('u', { text: 'add this to youtube', pages: PAGES, here: true })).toEqual({
    action: 'append',
    pageId: 'y',
    items: ['@this'],
  });
  expect(chat).toHaveBeenCalledWith(`${SYSTEM_PROMPT}
${HERE_RULE}`, JSON.stringify({
    pages: ['1. Groceries', '2. Arabic phrases', '3. YouTube watch list'],
    command: 'add this to youtube',
    here: true,
  }));
  expect(HERE_RULE).toContain('"@this"');
});

it('ignores a here that is not true', async () => {
  const { chat, core: c } = core('{"page": 1, "items": ["x"]}');
  await c.resolve('u', { text: 'x', pages: PAGES, here: 'yes' });
  expect(chat).toHaveBeenCalledWith(SYSTEM_PROMPT, JSON.stringify({
    pages: ['1. Groceries', '2. Arabic phrases', '3. YouTube watch list'],
    command: 'x',
  }));
});
