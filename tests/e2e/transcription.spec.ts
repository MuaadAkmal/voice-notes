import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
let server: http.Server;
let port: number;
// What the fake OpenAI-compatible server answers, and what it was sent.
let mode: 'ok' | '401' = 'ok';
const requests: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];

const shot = (name: string) =>
  page.screenshot({ path: `.superpowers/shots/transcription-${name}.png` });
async function setTheme(theme: 'light' | 'dark') {
  await t.app.evaluate(({ nativeTheme }, theme) => {
    nativeTheme.themeSource = theme;
  }, theme);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains('dark')),
    )
    .toBe(theme === 'dark');
  await page.waitForTimeout(250);
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.setHeader('content-type', 'application/json');
      if (mode === '401') {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: { message: 'Invalid key' } }));
      } else {
        res.end(JSON.stringify({ text: 'hola mundo', language: 'spanish' }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

test('transcribes a note through an OpenAI-compatible server', async () => {
  // Set up "My server".
  await page.getByRole('button', { name: 'Transcription' }).click();
  await expect(
    page.getByRole('heading', { name: 'Transcription' }),
  ).toBeVisible();
  const baseUrl = page.getByLabel('Base URL');
  await baseUrl.fill(`http://127.0.0.1:${port}/v1/`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(baseUrl).toHaveValue(`http://127.0.0.1:${port}/v1`);
  await page.getByLabel('API key').fill('test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByText('Key saved ••••-key')).toBeVisible();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText(/Connected ✓/)).toBeVisible();
  await setTheme('light');
  await shot('light');
  await setTheme('dark');
  await shot('dark');

  // Transcribe a recording.
  await t.record(1500);
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Play' }) });
  await row.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(row.getByText('hola mundo')).toBeVisible();
  await expect(row.getByText('es', { exact: true })).toBeVisible();
  const sent = requests.at(-1)!;
  expect(sent.headers.authorization).toBe('Bearer test-key');
  const body = sent.body.toString('latin1');
  expect(body).toContain('name="model"');
  expect(body).toContain('openai/whisper-large-v3');
  expect(body).toMatch(/RIFF[\s\S]{4}WAVE/);

  // Edit the transcript.
  await row.getByRole('button', { name: 'Show transcript' }).click();
  const box = row.getByLabel('Transcript');
  await box.press('End');
  await box.pressSequentially(' ayer');
  await box.blur();
  await expect
    .poll(() => t.hooks((h) => h.store.list()[0].transcript))
    .toBe('hola mundo ayer');

  // Search covers transcripts.
  await page.getByLabel('Search notes').fill('ayer');
  await expect(row).toBeVisible();
  await page.getByLabel('Search notes').fill('');

  // A rejected key shows on the row; Retry works once the server is fixed.
  mode = '401';
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Re-transcribe' }).click();
  await page.getByRole('button', { name: 'Re-transcribe' }).click();
  const failed = row.getByText('Failed');
  await expect(failed).toBeVisible();
  await expect(failed).toHaveAttribute('title', 'API key rejected');
  mode = 'ok';
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(failed).toBeHidden();
  await expect(row.getByText('hola mundo', { exact: true })).toBeVisible();
});

test('before setup, Transcribe actions lead to the Transcription page', async () => {
  await t.record(1200);
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Play' }) });
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Set up transcription' }).click();
  await expect(
    page.getByRole('heading', { name: 'Transcription' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Inbox/ }).click();
  await row.click({ position: { x: 120, y: 20 } });
  await page
    .getByRole('button', { name: 'Set up transcription', exact: true })
    .last()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Transcription' }),
  ).toBeVisible();
});
