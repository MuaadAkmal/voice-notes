import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let dashboard: Page;
const hooks: TestApp['hooks'] = (fn) => t.hooks(fn);
// The voice note's ⋯ menu (Inbox also lists the built-in Review later and Quick notes pages).
const noteMenu = () =>
  dashboard
    .locator('li[aria-selected]')
    .filter({ hasNotText: 'Review later' })
    .filter({ hasNotText: 'Quick notes' })
    .getByRole('button', { name: 'More' });

test.beforeEach(async () => {
  t = await launch();
  dashboard = t.dashboard;
  await t.dashboard.getByRole('button', { name: /^Inbox/ }).click(); // Home is the default view
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
  await noteMenu().click();
  await dashboard.getByRole('menuitem', { name: 'Delete' }).click();
  await dashboard.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(dashboard.getByText('hola')).toHaveCount(0);
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

test('cancelling the delete dialog keeps the note and the page stays clickable', async () => {
  await t.record(1200);
  await expect.poll(() => hooks((h) => h.store.list().length)).toBe(1);
  await noteMenu().click();
  await dashboard.getByRole('menuitem', { name: 'Delete' }).click();
  await dashboard.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(dashboard.getByRole('alertdialog')).toHaveCount(0);
  expect(await hooks((h) => h.store.list().length)).toBe(1);
  // Radix can leave body { pointer-events: none } behind when a dialog opens from a menu item.
  expect(await dashboard.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none');
  await dashboard.getByRole('button', { name: 'Settings' }).click({ timeout: 3000 });
  await expect(dashboard.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('cancel does not create a note', async () => {
  await hooks((h) => h.gesture.toggle());
  await dashboard.waitForTimeout(500);
  await hooks((h) => h.gesture.escape());
  await dashboard.waitForTimeout(1000);
  expect(await hooks((h) => h.store.list().length)).toBe(0);
  expect(fs.readdirSync(path.join(t.userData, 'recordings'))).toEqual([]);
});
