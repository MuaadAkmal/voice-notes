import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
// Visual checkpoints for manual review (git-ignored).
const shot = (name: string) => page.screenshot({ path: `.superpowers/shots/folders-${name}.png` });

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
  await t.dashboard.getByRole('button', { name: /^Inbox/ }).click(); // Home is the default view
});

test.afterEach(async () => {
  await t.close();
});

const sidebar = () => page.locator('aside');
const folderRow = (name: string) => sidebar().locator('li > div', { hasText: name }).first();

async function createFolder(name: string, parent?: string) {
  if (parent) {
    await folderRow(parent).hover();
    await folderRow(parent).getByRole('button', { name: 'Folder options' }).click();
    await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  } else {
    await page.getByRole('button', { name: 'New folder' }).click();
  }
  await page.getByPlaceholder('Folder name').fill(name);
  await page.keyboard.press('Enter');
  await expect(sidebar().getByText(name, { exact: true })).toBeVisible();
}

test('folders: create, drag a note in, delete folder returns it to Inbox', async () => {
  await t.record();
  await expect(page.getByText(/^Voice note · /)).toBeVisible();

  await createFolder('Spanish');
  const folderId = await t.hooks((h) => h.store.folders.list()[0].id);
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await shot('1-inbox');

  await page.locator('li[draggable="true"]').first().dragTo(folderRow('Spanish'));
  await expect.poll(() => t.hooks((h) => h.store.list()[0].folderId)).toBe(folderId);
  await expect(page.getByText('No notes yet')).toBeVisible();

  await folderRow('Spanish').getByText('Spanish').click();
  await expect(page.getByRole('heading', { name: 'Spanish' })).toBeVisible();
  await expect(page.getByText(/^Voice note · /)).toBeVisible();
  await shot('2-folder');

  await folderRow('Spanish').hover();
  await folderRow('Spanish').getByRole('button', { name: 'Folder options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.waitForTimeout(400); // let the menu/dialog animations settle
  await shot('6-confirm');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => t.hooks((h) => h.store.list()[0].folderId)).toBeNull();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});

test('folders: nesting, duplicate-name toast, multi-select drag, cycle refused', async () => {
  await t.record(800);
  await t.record(800);
  await t.record(800);
  await createFolder('Spanish');
  await createFolder('Films', 'Spanish');
  await shot('3-nested');

  // Duplicate sibling name shows the store's message, without Electron's prefix.
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByPlaceholder('Folder name').fill('spanish');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sonner-toast]')).toHaveText('A folder named "spanish" already exists here');
  await page.keyboard.press('Escape');

  // Shift-select two notes and drag them together into Films.
  await page.getByRole('button', { name: /^Inbox/ }).click();
  const rows = page.locator('li[draggable="true"]');
  await expect(rows).toHaveCount(3);
  await rows.nth(0).click({ position: { x: 360, y: 30 } });
  await rows.nth(1).click({ position: { x: 360, y: 30 }, modifiers: ['Shift'] });
  await expect(page.getByText('2 selected')).toBeVisible();
  await shot('4-selected');
  await rows.nth(0).dragTo(folderRow('Films'));
  await expect(rows).toHaveCount(1);
  const filmsId = await t.hooks((h) => h.store.folders.list().find((f) => f.name === 'Films')!.id);
  await expect.poll(() => t.hooks((h) => h.store.list().filter((n) => n.folderId !== null).length)).toBe(2);
  expect(await t.hooks((h) => h.store.list().filter((n) => n.folderId !== null).map((n) => n.folderId))).toEqual([
    filmsId,
    filmsId,
  ]);

  // Dropping Spanish onto its own child is refused.
  await folderRow('Spanish').dragTo(folderRow('Films'));
  expect(await t.hooks((h) => h.store.folders.list().find((f) => f.name === 'Spanish')!.parentId)).toBeNull();

  // All notes labels each row with its folder path.
  await page.getByRole('button', { name: /^All notes/ }).click();
  await expect(page.getByText('Spanish › Films')).toHaveCount(2);
  await shot('5-all');
});

test('playback stops when the playing note leaves the view', async () => {
  await t.record(8000); // long enough that it can't simply finish during the check
  await createFolder('Spanish');
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeGreaterThan(0);
  await folderRow('Spanish').getByText('Spanish').click();
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const a = document.querySelector('audio')!;
    return { paused: a.paused, ended: a.ended };
  });
  expect(state).toEqual({ paused: true, ended: false });
});
