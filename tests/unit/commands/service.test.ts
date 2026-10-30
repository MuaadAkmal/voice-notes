import { expect, it, vi } from 'vitest';
import { CommandsClient, LimitReached } from '../../../src/main/commands/client';
import { ListCommands } from '../../../src/main/commands/service';
import { AuthExpired, NotSignedIn, Offline } from '../../../src/main/sync/http-server';
import type { ResolveRequest, ResolveResponse } from '../../../src/shared/commands/protocol';
import type { Page } from '../../../src/shared/channels';

const page = (id: string, title: string, body = ''): Page =>
  ({ id, title, body, folderId: null, starred: false, createdAt: 1, updatedAt: 1 }) as Page;

function setup(reply: ResolveResponse | Error, pages = [page('g', 'Groceries'), page('a', 'Arabic phrases'), page('q', 'Quick notes')]) {
  const appended: [string, string][] = [];
  const sent: ResolveRequest[] = [];
  const pagesChanged = vi.fn();
  const svc = new ListCommands({
    resolve: async (req) => {
      sent.push(req);
      if (reply instanceof Error) throw reply;
      return reply;
    },
    pages: {
      list: () => pages,
      get: (id) => pages.find((p) => p.id === id),
      appendLine: (id, text) => (appended.push([id, text]), pages[0]),
    },
    quickNotes: () => 'q',
    pagesChanged,
  });
  return { svc, appended, sent, pagesChanged };
}

it('sends the page titles and appends each item to the chosen page', async () => {
  const { svc, appended, sent, pagesChanged } = setup({ action: 'append', pageId: 'g', items: ['milk', 'eggs'] });
  expect(await svc.add('add milk and eggs to groceries')).toEqual({ ok: true, message: 'Added · 2 items → Groceries' });
  expect(sent[0].pages.map((p) => p.title)).toEqual(['Groceries', 'Arabic phrases', 'Quick notes']);
  expect(appended).toEqual([['g', 'milk'], ['g', 'eggs']]);
  expect(pagesChanged).toHaveBeenCalledOnce();
});

it('names a single item', async () => {
  const { svc } = setup({ action: 'append', pageId: 'a', items: ['كيف الحال يا صديقي؟'] });
  expect(await svc.add('x')).toEqual({ ok: true, message: 'Added · كيف الحال يا صديقي؟ → Arabic phrases' });
});

it('no matching page: the items go to Quick notes', async () => {
  const { svc, appended } = setup({ action: 'none', reason: 'no-match', items: ['call the bank'] });
  expect(await svc.add('remember to call the bank')).toEqual({ ok: true, message: 'Added · call the bank → Quick notes' });
  expect(appended).toEqual([['q', 'call the bank']]);
});

it('no items made out, or a page it did not send: the whole command goes to Quick notes', async () => {
  for (const reply of [{ action: 'none', reason: 'unclear' }, { action: 'append', pageId: 'elsewhere', items: ['x'] }] as ResolveResponse[]) {
    const { svc, appended } = setup(reply);
    expect((await svc.add('the whole thing')).ok).toBe(true);
    expect(appended).toEqual([['q', 'the whole thing']]);
  }
});

it('a failed call still saves the command to Quick notes, and says why', async () => {
  const msg = async (e: Error) => {
    const { svc, appended } = setup(e);
    const r = await svc.add('buy stamps');
    expect(appended).toEqual([['q', 'buy stamps']]);
    return r.message;
  };
  expect(await msg(new NotSignedIn())).toBe('Added · buy stamps → Quick notes (sign in to sort into lists)');
  expect(await msg(new AuthExpired())).toBe('Added · buy stamps → Quick notes (sign in again to sort into lists)');
  expect(await msg(new LimitReached())).toBe('Added · buy stamps → Quick notes (daily limit reached)');
  expect(await msg(new Offline())).toBe('Added · buy stamps → Quick notes (offline)');
  expect(await msg(new Error('x'))).toBe("Added · buy stamps → Quick notes (couldn't sort it)");
});

it('the client posts to the function with the sign-in token and maps statuses', async () => {
  const call = async (res: Response | Error, token: string | null = 't') => {
    const fetch = vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    const client = new CommandsClient({ baseUrl: 'https://p.supabase.co', apiKey: 'pk', getToken: async () => token, fetch: fetch as never });
    return { result: client.resolve({ text: 'x', pages: [] }), fetch };
  };
  const ok = await call(new Response(JSON.stringify({ action: 'none', reason: 'no-match' })));
  expect(await ok.result).toEqual({ action: 'none', reason: 'no-match' });
  const [url, init] = ok.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://p.supabase.co/functions/v1/commands/resolve');
  expect(init.headers).toMatchObject({ authorization: 'Bearer t', apikey: 'pk' });
  await expect((await call(new Response('', { status: 401 }))).result).rejects.toBeInstanceOf(AuthExpired);
  await expect((await call(new Response('', { status: 429 }))).result).rejects.toBeInstanceOf(LimitReached);
  await expect((await call(new Response('', { status: 502 }))).result).rejects.toThrow('lists server');
  await expect((await call(new TypeError('offline'))).result).rejects.toBeInstanceOf(Offline);
  await expect((await call(new Response('{}'), null)).result).rejects.toBeInstanceOf(NotSignedIn);
});
