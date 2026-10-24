import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let dashboard: Page;
const hooks: TestApp['hooks'] = (fn) => t.hooks(fn);

test.beforeEach(async () => {
  t = await launch();
  dashboard = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

test('records a note via gesture and manages it from the dashboard', async () => {
  await t.record();
  await expect.poll(() => hooks((h) => h.store.list().length)).toBe(1);

  const file = await hooks((h) => h.store.absolutePath(h.store.list()[0]));
  expect(fs.statSync(file).size).toBeGreaterThan(0);

  await expect(dashboard.getByText('Today')).toBeVisible();
  await expect(dashboard.getByText(/^Voice note · \d\d:\d\d$/)).toBeVisible();

  // Playback through note://
  await dashboard.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(() => dashboard.evaluate(() => document.querySelector('audio')!.currentTime))
    .toBeGreaterThan(0);

  // Rename
  await dashboard.getByTitle('Click to rename').click();
  await dashboard.keyboard.type('hola');
  await dashboard.keyboard.press('Enter');
  await expect(dashboard.getByText('hola')).toBeVisible();
  await expect.poll(() => hooks((h) => h.store.list()[0].title)).toBe('hola');

  // Delete
  await dashboard.getByRole('button', { name: 'More' }).click();
  await dashboard.getByRole('menuitem', { name: 'Delete' }).click();
  await dashboard.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(dashboard.getByText('No notes yet')).toBeVisible();
  expect(fs.existsSync(file)).toBe(false);
});

test('records system audio when the source is set to system', async () => {
  await dashboard.evaluate(() => window.dashboardApi.setSettings({ recordingSource: 'system' }));
  await t.record(1500);
  await expect.poll(() => hooks((h) => h.store.list().length)).toBe(1);
  const note = (await hooks((h) => h.store.list()))[0];
  expect(note.source).toBe('system');
  expect(fs.statSync(await hooks((h) => h.store.absolutePath(h.store.list()[0]))).size).toBeGreaterThan(0);
  await expect(dashboard.getByLabel('Includes system audio')).toBeVisible();
});

test('cancel does not create a note', async () => {
  await hooks((h) => h.gesture.toggle());
  await dashboard.waitForTimeout(500);
  await hooks((h) => h.gesture.escape());
  await dashboard.waitForTimeout(1000);
  expect(await hooks((h) => h.store.list().length)).toBe(0);
  expect(fs.readdirSync(path.join(t.userData, 'recordings'))).toEqual([]);
});
