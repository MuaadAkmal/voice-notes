import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { startCommandsServer } from './fixtures/commands-server';
import { launch, type TestApp } from './launch';

// Undo / Move to… on the pill after "Pixie, add milk": the item goes to Quick notes (no page fits),
// and the pill takes it back or puts it on another page.

const USER = '11111111-1111-4111-8111-111111111111';
let t: TestApp;
let whisper: http.Server;
let whisperUrl: string;
let commands: Awaited<ReturnType<typeof startCommandsServer>>;

test.beforeAll(async () => {
  whisper = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' Pixie, add milk.' })));
  });
  await new Promise<void>((r) => whisper.listen(0, '127.0.0.1', r));
  whisperUrl = `http://127.0.0.1:${(whisper.address() as AddressInfo).port}/v1`;
  commands = await startCommandsServer({ userId: USER }, { resolve: JSON.stringify({ page: null, items: ['milk'] }) });
});
test.afterAll(async () => {
  whisper.close();
  await commands.close();
});
test.afterEach(async () => {
  await t?.close();
});

const overlay = async (): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const p = t.app.windows().find((w) => w.url().includes('/overlay/'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

async function ready() {
  t = await launch();
  await t.app.evaluate(
    (_e, url) => {
      const h = (globalThis as unknown as { __voiceNotes: Record<string, any> }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
      h.commands.useServer(url);
      h.commands.useToken(async () => 'test-token');
    },
    commands.url,
  );
  await t.dashboard.evaluate(
    (u) => window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl: u, model: 'whisper', localModel: null } }),
    whisperUrl,
  );
  await t.hooks((h) => {
    const pages = h.store.pages as unknown as { create(folderId: null): { id: string }; rename(id: string, title: string): void };
    pages.rename(pages.create(null).id, 'Groceries');
  });
  return overlay();
}

const dictate = async () => {
  await t.hooks((h) => h.dictationGesture.toggle());
  await t.dashboard.waitForTimeout(1200);
  await t.hooks((h) => h.dictationGesture.toggle());
};
// hooks() sends the function as source text, so it can't see `title`: filter here.
const body = async (title: string) =>
  (await t.hooks((h) => h.store.pages.list().map((p) => ({ title: p.title, body: p.body })))).find((p) => p.title === title)?.body ?? '';

test('Undo takes the item back off the page', async () => {
  const pill = await ready();
  await dictate();
  await expect(pill.getByTestId('pill')).toContainText('Added · milk → Quick notes', { timeout: 15_000 });
  expect(await body('Quick notes')).toContain('- milk');
  await pill.screenshot({ path: '.superpowers/shots/undo-flash.png' });
  await pill.getByRole('button', { name: 'Undo' }).click();
  await expect(pill.getByTestId('pill')).toContainText('Undone');
  expect(await body('Quick notes')).not.toContain('- milk');
});

test('Move to… puts it on the page picked on the pill', async () => {
  const pill = await ready();
  await dictate();
  await expect(pill.getByTestId('pill')).toContainText('Added · milk → Quick notes', { timeout: 15_000 });
  await pill.getByRole('button', { name: 'Move to…' }).click();
  await pill.getByLabel('Page to move to').fill('groc');
  await pill.screenshot({ path: '.superpowers/shots/undo-picker.png' });
  await pill.getByRole('button', { name: 'Groceries' }).dispatchEvent('mousedown');
  await expect(pill.getByTestId('pill')).toContainText('Moved → Groceries');
  expect(await body('Groceries')).toContain('- milk');
  expect(await body('Quick notes')).not.toContain('- milk');
});
