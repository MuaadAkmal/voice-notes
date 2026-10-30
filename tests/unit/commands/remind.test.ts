import { expect, it, vi } from 'vitest';
import { CommandsCore, LimitReached, readRemindReply, REMIND_PROMPT } from '../../../src/shared/commands/core';
import { handleCommands, type CommandsHandlerDeps } from '../../../src/shared/commands/handler';
import type { RemindResponse } from '../../../src/shared/commands/protocol';
import { MemoryUsageStore } from '../../../src/shared/commands/store';
import { CommandsClient } from '../../../src/main/commands/client';

const NOW = Date.UTC(2026, 9, 30, 12);
const iso = (ms: number) => new Date(ms).toISOString();
const REQ = { text: 'remind me after lunch on Friday to call mom', now: iso(NOW), tz: 'Asia/Tokyo' };

it('reads a future time and the task', () => {
  expect(readRemindReply(`{"text":"call mom","due":"${iso(NOW + 3_600_000)}"}`, NOW)).toEqual({
    action: 'remind',
    text: 'call mom',
    dueAt: iso(NOW + 3_600_000),
  });
});

it('turns anything else into none', () => {
  const none = { action: 'none' };
  expect(readRemindReply('not json', NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"x","due":null}`, NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"x","due":"${iso(NOW - 1000)}"}`, NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"x","due":"${iso(NOW + 366 * 86_400_000)}"}`, NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"x","due":"tomorrow"}`, NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"","due":"${iso(NOW + 1000)}"}`, NOW)).toEqual(none);
  expect(readRemindReply(`{"text":"${'a'.repeat(201)}","due":"${iso(NOW + 1000)}"}`, NOW)).toEqual(none);
});

it('sends now and tz with the command, and shares the daily cap with resolve', async () => {
  const usage = new MemoryUsageStore();
  const chat = vi.fn(async () => `{"text":"call mom","due":"${iso(NOW + 1000)}"}`);
  const core = new CommandsCore({ chat, usage, dailyLimit: 1, now: () => NOW });
  expect((await core.remind('u', REQ)).action).toBe('remind');
  expect(chat).toHaveBeenCalledWith(REMIND_PROMPT, JSON.stringify({ now: REQ.now, tz: REQ.tz, command: REQ.text }));
  await expect(core.remind('u', REQ)).rejects.toBeInstanceOf(LimitReached);
});

it('refuses a request without text, now or tz', async () => {
  const core = new CommandsCore({ chat: async () => '{}', usage: new MemoryUsageStore(), dailyLimit: 9, now: () => NOW });
  for (const bad of [{ ...REQ, text: '' }, { ...REQ, tz: undefined }, { ...REQ, now: 'x' }]) {
    await expect(core.remind('u', bad)).rejects.toThrow();
  }
});

it('routes POST /remind in the handler', async () => {
  const OK: RemindResponse = { action: 'none' };
  const deps: CommandsHandlerDeps = {
    verify: async () => ({ userId: 'u1' }),
    core: { resolve: async () => ({ action: 'none', reason: 'unclear' }), remind: async () => OK },
    missing: [],
  };
  const res = await handleCommands(
    new Request('https://x.supabase.co/functions/v1/commands/remind', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(REQ) }),
    deps,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(OK);
});

it('client posts to the remind route', async () => {
  const fetch = vi.fn(async () => new Response('{"action":"none"}'));
  const client = new CommandsClient({ baseUrl: 'https://p', apiKey: 'k', getToken: async () => 't', fetch: fetch as never });
  expect(await client.remind(REQ)).toEqual({ action: 'none' });
  expect((fetch.mock.calls[0] as unknown[])[0]).toBe('https://p/functions/v1/commands/remind');
});
