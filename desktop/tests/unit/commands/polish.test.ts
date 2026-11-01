import { describe, expect, it, vi } from 'vitest';
import { LimitReached } from '../../../src/shared/commands/core';
import { LlmFailed } from '../../../src/shared/commands/groq';
import { handleCommands } from '../../../src/shared/commands/handler';
import { MAX_POLISH_TEXT, POLISH_PROMPT, PolishCore, readPolish } from '../../../src/shared/commands/polish';
import { MemoryUsageStore } from '../../../src/shared/commands/store';

const DICTATED =
  "So, uh, I'm looking for a punchy line that we can give on the landing page, on the landing page, something that comprises all what I said.";
const reply = (text: unknown) => JSON.stringify({ text });

describe('readPolish keeps only a tidied copy of what was said', () => {
  it('takes a cleaned version', () => {
    const clean = "So I'm looking for a punchy line that we can give on the landing page, something that comprises all what I said.";
    expect(readPolish(reply(clean), DICTATED)).toBe(clean);
  });

  it('takes a list made of the same words', () => {
    const said = 'I need three things first milk second eggs and third bread for the morning';
    const list = 'I need three things:\n\n1. Milk\n2. Eggs\n3. Bread\n\nfor the morning';
    expect(readPolish(reply(list), said)).toBe(list);
  });

  it('takes other languages and scripts', () => {
    const said = 'أريد أن أذهب إلى السوق غدا صباحا مع أخي';
    expect(readPolish(reply(`${said}.`), said)).toBe(`${said}.`);
  });

  it.each([
    ['an answer instead of a cleanup', 'Capture what you learn, save what you find, and come back when you are ready to think.'],
    ['a short summary', 'Looking for a punchy line.'],
    ['a translation', 'Je cherche une phrase percutante pour la page de destination de notre site.'],
    ['nothing', ''],
  ])('refuses %s', (_, out) => {
    expect(readPolish(reply(out), DICTATED)).toBeNull();
  });

  it.each(['not json', '[]', '{"text":5}', 'null'])('refuses the reply %s', (content) => {
    expect(readPolish(content, DICTATED)).toBeNull();
  });
});

const core = (chat = vi.fn(async () => reply(DICTATED)), dailyLimit = 1000) =>
  new PolishCore({ chat, usage: new MemoryUsageStore(), dailyLimit, now: () => Date.UTC(2026, 10, 1) });

describe('PolishCore', () => {
  it('sends the transcript as data under the fixed instructions', async () => {
    const chat = vi.fn(async () => reply(DICTATED));
    expect(await core(chat).polish('u', { text: DICTATED })).toEqual({ text: DICTATED });
    expect(chat).toHaveBeenCalledWith(POLISH_PROMPT, JSON.stringify({ transcript: DICTATED }));
  });

  it('answers null when the reply is not the same text', async () => {
    expect(await core(vi.fn(async () => reply('Remember everything.'))).polish('u', { text: DICTATED })).toEqual({ text: null });
  });

  it('refuses over the daily cap, per account', async () => {
    const c = core(undefined, 1);
    await c.polish('a', { text: DICTATED });
    await expect(c.polish('a', { text: DICTATED })).rejects.toBeInstanceOf(LimitReached);
    await expect(c.polish('b', { text: DICTATED })).resolves.toBeTruthy();
  });

  it.each([{}, { text: '  ' }, { text: 5 }, null, { text: 'x'.repeat(MAX_POLISH_TEXT + 1) }])('refuses the request %j', async (body) => {
    await expect(core().polish('u', body)).rejects.toThrow('text');
  });
});

describe('the polish route', () => {
  const post = (body: unknown, auth = 'Bearer t') =>
    new Request('https://x/functions/v1/commands/polish', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) });
  const deps = (polish: { polish: PolishCore['polish'] }) => ({
    verify: async (jwt: string) => (jwt === 't' ? { userId: 'u' } : null),
    core: { resolve: vi.fn(), remind: vi.fn() },
    polish,
    missing: [],
  });

  it('answers with the text', async () => {
    const res = await handleCommands(post({ text: 'hi' }), deps({ polish: async () => ({ text: 'Hi.' }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Hi.' });
  });

  it('needs a valid token', async () => {
    const res = await handleCommands(post({ text: 'hi' }, 'Bearer no'), deps({ polish: async () => ({ text: 'Hi.' }) }));
    expect(res.status).toBe(401);
  });

  it('says limit and llm failures by kind, without internals', async () => {
    const limit = await handleCommands(post({ text: 'hi' }), deps({ polish: async () => { throw new LimitReached(); } }));
    expect(limit.status).toBe(429);
    const llm = await handleCommands(post({ text: 'hi' }), deps({ polish: async () => { throw new LlmFailed('secret detail'); } }));
    expect(llm.status).toBe(502);
    expect(await llm.text()).not.toContain('secret');
  });
});
