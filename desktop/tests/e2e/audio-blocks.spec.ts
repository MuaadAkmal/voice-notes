import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

// /audio in a page records a voice block with the dashboard's mic (the fake device), saves it as a
// note the page owns, and shows a player with the transcript the fake Whisper server returns.

let t: TestApp;
let whisper: http.Server;
let whisperUrl: string;

test.beforeAll(async () => {
  whisper = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' remember the blue door' })));
  });
  await new Promise<void>((r) => whisper.listen(0, '127.0.0.1', r));
  whisperUrl = `http://127.0.0.1:${(whisper.address() as AddressInfo).port}/v1`;
});
test.afterAll(() => {
  whisper.close();
});
test.afterEach(async () => {
  await t?.close();
});

/** A new page from the Inbox toolbar, titled, with the cursor in its body. */
async function newPage(page: TestApp['dashboard'], title: string) {
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByRole('button', { name: 'New text note', exact: true }).click();
  await expect(page.getByLabel('Title')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeFocused();
}

test('/audio records a voice block that plays in the page and stays out of the note lists', async () => {
  t = await launch();
  const page = t.dashboard;
  await page.evaluate(
    (u) => window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl: u, model: 'whisper', localModel: null } }),
    whisperUrl,
  );
  await newPage(page, 'Ideas');
  const editor = page.locator('.cm-content');
  await page.keyboard.type('/audio');
  await page.keyboard.press('Enter');

  const recorder = page.getByLabel('Voice block recorder');
  await expect(recorder).toBeVisible();
  await expect(editor).not.toContainText('/audio');
  await recorder.getByRole('button', { name: '● Record' }).dispatchEvent('mousedown');
  await expect(recorder.getByRole('button', { name: '■ Stop' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '.superpowers/shots/audio-block-recording.png' });
  await recorder.getByRole('button', { name: '■ Stop' }).dispatchEvent('mousedown');

  const player = page.getByLabel('Voice block', { exact: true });
  await expect(player).toBeVisible({ timeout: 15_000 });
  await expect(player).toContainText('remember the blue door', { timeout: 15_000 });
  await page.screenshot({ path: '.superpowers/shots/audio-block-player.png' });

  const notes = await t.hooks((h) => h.store.list().map((n) => ({ pageId: n.pageId ?? null })));
  expect(notes).toHaveLength(1);
  expect(notes[0].pageId).toBeTruthy();
  expect(await page.evaluate(() => window.dashboardApi.listNotes().then((ns) => ns.length))).toBe(0);
  // The body autosaves 500 ms after the edit.
  await expect.poll(() => t.hooks((h) => h.store.pages.list().map((p) => p.body).join('\n'))).toMatch(/\[🎙 Voice note\]\(note:\/\/[0-9a-f-]{36}\)/);
});

test('Esc closes the recorder without saving anything', async () => {
  t = await launch();
  const page = t.dashboard;
  await newPage(page, 'Ideas');
  await page.keyboard.type('/audio');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Voice block recorder')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Voice block recorder')).toBeHidden();
  expect(await t.hooks((h) => h.store.list().length)).toBe(0);
});
