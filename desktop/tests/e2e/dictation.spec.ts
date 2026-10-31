import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
let server: http.Server;
let port: number;

const overlay = async (app: TestApp): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const p = app.app.windows().find((w) => w.url().includes('/overlay/'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

/** Points transcription at the fake server, as the Transcription page would. */
const setUpTranscription = () =>
  page.evaluate(
    (baseUrl) =>
      window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl, model: 'whisper', localModel: null } }),
    `http://127.0.0.1:${port}/v1`,
  );

/** A hands-free dictation through the real gesture → controller → overlay → server path. */
const dictate = async (ms = 1500) => {
  await t.hooks((h) => h.dictationGesture.toggle());
  await page.waitForTimeout(ms);
  await t.hooks((h) => h.dictationGesture.toggle());
};

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: ' hello world', language: 'en' }));
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

test('dictates into the focused app and lists it', async () => {
  await setUpTranscription();
  await t.hooks((h) => h.setForeground(() => ({ title: 'general | Slack', processName: 'slack.exe', pid: 1 })));
  await dictate();
  await expect.poll(() => t.hooks((h) => h.pasted), { timeout: 15_000 }).toEqual(['hello world']);

  await page.getByRole('button', { name: /^Dictation/ }).click();
  const row = page.getByTestId('dictation-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('hello world');
  await row.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/dictation-panel.png' });

  await page.getByLabel('Search dictations').fill('nothing like it');
  await expect(row).toHaveCount(0);
});

test('Clear all empties the panel', async () => {
  await setUpTranscription();
  await dictate();
  await expect.poll(() => t.hooks((h) => h.pasted.length), { timeout: 15_000 }).toBe(1);
  await page.getByRole('button', { name: /^Dictation/ }).click();
  await expect(page.getByTestId('dictation-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByTestId('dictation-row')).toHaveCount(0);
});

test('without transcription set up, the pill says so', async () => {
  const pill = await overlay(t);
  await t.hooks((h) => h.dictationGesture.toggle());
  await expect(pill.getByTestId('pill')).toContainText('Set up transcription first');
});
