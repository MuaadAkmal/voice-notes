import fs from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;

const overlay = async (app: TestApp): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const page = app.app.windows().find((w) => w.url().includes('/overlay/'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

test.afterEach(async () => {
  await t.close();
});

test('rewind needs film mode, then saves the last seconds of system audio as a rewind note', async () => {
  t = await launch();
  const pill = await overlay(t);
  await t.hooks((h) => h.rewind());
  await expect(pill.getByText('Turn on film mode to rewind')).toBeVisible();

  await t.dashboard.evaluate(() => window.dashboardApi.setSettings({ filmMode: true, rewindSeconds: 10 }));
  await expect(pill.getByTestId('film-dot')).toBeVisible({ timeout: 5000 });
  await pill.screenshot({ path: '.superpowers/shots/pill-film.png' });
  await pill.waitForTimeout(2500); // let the buffer fill
  await t.hooks((h) =>
    h.setForeground(() => ({ title: 'La Casa de Papel | Netflix - Google Chrome', processName: 'chrome.exe', pid: 1 })),
  );
  await t.hooks((h) => h.rewind());
  await expect.poll(() => t.hooks((h) => h.store.list().length), { timeout: 8000 }).toBe(1);
  const [note] = await t.hooks((h) => h.store.list());
  expect(note).toMatchObject({ kind: 'rewind', source: 'system', show: 'La Casa de Papel', mimeType: 'audio/webm;codecs=opus' });
  expect(note.durationMs).toBeGreaterThan(1500);
  expect(note.durationMs).toBeLessThanOrEqual(10_000);
  const file = await t.hooks((h) => h.store.absolutePath(h.store.list()[0]));
  expect(fs.statSync(file).size).toBeGreaterThan(500);
  expect(fs.readFileSync(file).subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML (WebM) header
  await expect(pill.getByRole('button', { name: /Add title/ })).toBeVisible();

  // Turning film mode off removes the dot.
  await t.dashboard.evaluate(() => window.dashboardApi.setSettings({ filmMode: false }));
  await pill.waitForTimeout(4500); // the saved flash ends
  await expect(pill.getByTestId('film-dot')).toHaveCount(0);
});

test('a note remembers the window it was recorded over', async () => {
  t = await launch();
  await t.hooks((h) =>
    h.setForeground(() => ({ title: '(2) Dark - YouTube - Google Chrome', processName: 'chrome.exe', pid: 1 })),
  );
  await t.record(1500);
  const [note] = await t.hooks((h) => h.store.list());
  expect(note).toMatchObject({ kind: 'note', show: 'Dark', windowTitle: '(2) Dark - YouTube - Google Chrome' });
});

test('auto-pause never presses the media key for a system-audio note', async () => {
  t = await launch();
  await t.dashboard.evaluate(() => window.dashboardApi.setSettings({ recordingSource: 'system' }));
  await t.record(1500);
  expect(await t.hooks((h) => h.mediaPresses())).toBe(0);
});

test('auto-pause presses play/pause around a mic note while something is playing', async () => {
  // Under fake media devices, loopback hears the fake input too: a steady tone stands in for a film.
  t = await launch({ fakeAudioFile: 'tests/e2e/fixtures/tone.wav' });
  await t.hooks((h) => h.gesture.toggle());
  await expect.poll(() => t.hooks((h) => h.mediaPresses()), { timeout: 4000 }).toBe(1);
  await t.hooks((h) => h.gesture.toggle());
  await expect.poll(() => t.hooks((h) => h.mediaPresses())).toBe(2);
  await expect.poll(() => t.hooks((h) => h.store.list().length)).toBe(1);
});

test('auto-pause stays off when the setting is off', async () => {
  t = await launch({ fakeAudioFile: 'tests/e2e/fixtures/tone.wav' });
  await t.dashboard.evaluate(() => window.dashboardApi.setSettings({ autoPause: false }));
  await t.record(1200);
  expect(await t.hooks((h) => h.mediaPresses())).toBe(0);
});