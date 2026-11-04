import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { startCommandsServer } from './fixtures/commands-server';
import { launch, type TestApp } from './launch';

// New notes are transcribed by themselves and titled by the `commands` function; custom words go
// along as the Whisper prompt.

const USER = '11111111-1111-4111-8111-111111111111';
let t: TestApp;
let whisper: http.Server;
let whisperUrl: string;
const prompts: string[] = [];
let commands: Awaited<ReturnType<typeof startCommandsServer>>;

test.beforeAll(async () => {
  whisper = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const prompt = /name="prompt"\r\n\r\n([^\r]*)/.exec(Buffer.concat(chunks).toString('utf8'));
      prompts.push(prompt?.[1] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' buy milk and eggs for Sunday' }));
    });
  });
  await new Promise<void>((r) => whisper.listen(0, '127.0.0.1', r));
  whisperUrl = `http://127.0.0.1:${(whisper.address() as AddressInfo).port}/v1`;
  commands = await startCommandsServer({ userId: USER });
});
test.afterAll(async () => {
  whisper.close();
  await commands.close();
});
test.afterEach(async () => {
  await t?.close();
});

async function ready(patch: Record<string, unknown> = {}) {
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
    ({ u, patch }) => window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl: u, model: 'whisper', localModel: null }, ...patch }),
    { u: whisperUrl, patch },
  );
  return t.dashboard;
}

test('a new note is transcribed and titled by itself, with the custom words as the prompt', async () => {
  const page = await ready({ customWords: ['Muaad', 'Pixie'] });
  await t.record(1200);
  await expect.poll(() => t.hooks((h) => h.store.list()[0]?.title), { timeout: 15_000 }).toBe('Shopping list');
  expect(await t.hooks((h) => h.store.list()[0].transcript)).toBe('buy milk and eggs for Sunday');
  expect(prompts.at(-1)).toBe('Glossary: Muaad, Pixie.');
  expect(commands.bodies('title').at(-1)).toEqual({ text: 'buy milk and eggs for Sunday' });

  await page.getByRole('button', { name: /^Inbox/ }).click();
  await expect(page.getByText('Shopping list')).toBeVisible();
  await page.getByRole('button', { name: 'Transcription' }).click();
  await expect(page.getByRole('switch', { name: 'Transcribe new notes' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Give them a title' })).toBeChecked();
  await expect(page.getByRole('list', { name: 'Custom words' })).toContainText('Muaad');
  await page.screenshot({ path: '.superpowers/shots/auto-transcribe-settings.png' });
});

test('with titles off, the note keeps its own title', async () => {
  await ready({ autoTitle: false });
  const before = commands.bodies('title').length;
  await t.record(1200);
  await expect.poll(() => t.hooks((h) => h.store.list()[0]?.transcript), { timeout: 15_000 }).toBe('buy milk and eggs for Sunday');
  await t.hooks((h) => h.transcription.idle());
  expect(commands.bodies('title').length).toBe(before);
  expect(await t.hooks((h) => h.store.list()[0].title)).not.toBe('Shopping list');
});

test('custom words are added and removed on the Transcription page', async () => {
  const page = await ready();
  await page.getByRole('button', { name: 'Transcription' }).click();
  const box = page.getByLabel('Add a word');
  await box.fill('Supabase');
  await box.press('Enter');
  await box.fill('Groq,');
  await expect(page.getByRole('list', { name: 'Custom words' })).toContainText('Supabase');
  await expect(page.getByRole('list', { name: 'Custom words' })).toContainText('Groq');
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.customWords))).toEqual(['Supabase', 'Groq']);
  await page.getByRole('button', { name: 'Remove Supabase' }).click();
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.customWords))).toEqual(['Groq']);
});
