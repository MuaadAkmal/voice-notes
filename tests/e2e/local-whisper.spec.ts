import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { MODEL_DISPLAY } from '../../src/shared/transcription';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
let server: http.Server;
let port: number;

const enc = (s: string) => new TextEncoder().encode(s);
const ZIP = zipSync({
  'Release/whisper-server.exe': enc('exe'),
  'Release/whisper.dll': enc('dll'),
  'Release/ggml.dll': enc('ggml'),
});
const MODEL = new Uint8Array(1024).fill(7);
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

/** The pinned catalog swapped for files this test serves, and whisper-server.exe for a Node script. */
async function useFakeEngine() {
  const catalog = {
    engine: { file: 'whisper-bin-x64.zip', bytes: ZIP.length, sha256: sha(ZIP), urls: [`http://127.0.0.1:${port}/engine.zip`] },
    models: [
      {
        id: 'base',
        ...MODEL_DISPLAY.base,
        file: 'ggml-base.bin',
        bytes: MODEL.length,
        sha256: sha(MODEL),
        urls: [`http://127.0.0.1:${port}/ggml-base.bin`],
      },
    ],
  };
  const script = path.resolve('tests/e2e/fixtures/fake-whisper-server.mjs');
  await t.app.evaluate(
    (_e, o) =>
      (globalThis as unknown as { __voiceNotes: { localWhisper: { setTestOverrides(o: unknown): void } } }).__voiceNotes.localWhisper.setTestOverrides(o),
    { catalog, spawn: { script } },
  );
}

/** Installed and in use, without going through the page. */
async function useBuiltIn() {
  await useFakeEngine();
  await t.app.evaluate(
    (_e) =>
      (globalThis as unknown as { __voiceNotes: { localWhisper: { install(id: string): Promise<void> } } }).__voiceNotes.localWhisper.install('base'),
  );
  await page.evaluate(() =>
    window.dashboardApi.setSettings({
      transcription: { provider: 'local', baseUrl: '', model: 'openai/whisper-large-v3', localModel: 'base' },
    }),
  );
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/engine.zip') return res.end(Buffer.from(ZIP));
    if (req.url === '/ggml-base.bin') return res.end(Buffer.from(MODEL));
    res.statusCode = 404;
    res.end();
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

test('downloads a model and switches to built-in', async () => {
  await useFakeEngine();
  await page.getByRole('button', { name: 'Transcription' }).click();
  await page.getByRole('tab', { name: /Built-in/ }).click();
  await expect(page.getByText('Runs on this PC. Nothing is sent anywhere.')).toBeVisible();
  const row = page.getByRole('radio', { name: /^Base,/ });
  await row.click();
  await expect(page.getByRole('button', { name: 'Use built-in' })).toHaveCount(0); // one action: Download, until it's here
  await expect(page.getByRole('button', { name: /^Download/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Download Base', exact: true }).click();
  await expect(row.getByText('Downloaded')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Use built-in' }).click();
  await expect
    .poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.transcription)))
    .toMatchObject({ provider: 'local', localModel: 'base' });
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText(/Ready ✓/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '.superpowers/shots/transcription-built-in.png' });
});

test('a voice note transcribes through the built-in engine', async () => {
  await useBuiltIn();
  await t.record(1500);
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const row = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Play' }) });
  await row.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await expect(row.getByText('hello from local')).toBeVisible({ timeout: 15_000 });
});

test('dictation pastes text from the built-in engine', async () => {
  await useBuiltIn();
  await t.hooks((h) => h.dictationGesture.toggle());
  await page.waitForTimeout(1500);
  await t.hooks((h) => h.dictationGesture.toggle());
  await expect.poll(() => t.hooks((h) => h.pasted), { timeout: 15_000 }).toEqual(['hello from local']);
});
