import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
// Visual checkpoints for manual review (git-ignored).
const shot = (name: string) =>
  page.screenshot({ path: `.superpowers/shots/pages-${name}.png` });
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

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

const sidebar = () => page.locator('aside');
const folderRow = (name: string) =>
  sidebar().locator('li > div', { hasText: name }).first();
const body = () => t.hooks((h) => h.store.pages.list()[0]?.body ?? null);
const editor = () => page.locator('.cm-content');

/** New text note from the list toolbar; titles it and leaves the cursor in the body. */
async function newPage(title: string) {
  await page.getByRole('button', { name: 'New text note' }).click();
  const input = page.getByLabel('Title');
  await expect(input).toBeFocused();
  // The fresh title is selected, so typing replaces it.
  expect(
    await input.evaluate((el: HTMLInputElement) => [
      el.value,
      el.selectionStart,
      el.selectionEnd,
    ]),
  ).toEqual(['Untitled', 0, 8]);
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(editor()).toBeFocused();
}

test('pages: create, write markdown, persists', async () => {
  await newPage('Spanish words');
  await expect
    .poll(() => t.hooks((h) => h.store.pages.list()[0].title))
    .toBe('Spanish words');
  await page.keyboard.type('# Hola');
  await page.keyboard.press('Enter');
  await page.keyboard.type('**bold** text');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] task');
  await page.keyboard.press('Enter');

  // The cursor has left the heading line, so it renders: heading style, `#` hidden.
  await expect(page.locator('.cm-line.cm-md-h1')).toHaveText('Hola');
  const box = page.locator('.cm-content input[type=checkbox]').first();
  await expect(box).toBeVisible();
  await setTheme('light');
  await shot('1-light');
  await setTheme('dark');
  await shot('1-dark');

  await box.click();
  await expect.poll(body).toContain('- [x] task');
  await page.waitForTimeout(700);
  const saved = await body();
  expect(saved).toMatch(/^# Hola\n\*\*bold\*\* text\n- \[x\] task/);

  await t.close();
  t = await launch({ userData: t.userData });
  page = t.dashboard;
  expect(await body()).toBe(saved);
  const row = page.locator('li[aria-selected]', { hasText: 'Spanish words' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Hola', { exact: true })).toBeVisible();
  await setTheme('light');
  await shot('2-inbox-light');
  await setTheme('dark');
  await shot('2-inbox-dark');
});

test('pages: flush on navigation', async () => {
  await newPage('Quick');
  await page.keyboard.type('quick');
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await expect.poll(body).toContain('quick');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});

test('pages: folders, search, delete', async () => {
  await newPage('Spanish words');
  await page.keyboard.type('# Hola');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect.poll(body).toBe('# Hola');

  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByPlaceholder('Folder name').fill('Spanish');
  await page.keyboard.press('Enter');
  await expect(sidebar().getByText('Spanish', { exact: true })).toBeVisible();
  const folderId = await t.hooks((h) => h.store.folders.list()[0].id);

  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page
    .locator('li[draggable="true"]', { hasText: 'Spanish words' })
    .dragTo(folderRow('Spanish'));
  await expect
    .poll(() => t.hooks((h) => h.store.pages.list()[0].folderId))
    .toBe(folderId);
  await expect(page.getByText('No notes yet')).toBeVisible();
  await folderRow('Spanish').getByText('Spanish').click();
  await expect(
    page.locator('li[aria-selected]', { hasText: 'Spanish words' }),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByLabel('Search notes').fill('hola');
  const hit = page.locator('li[aria-selected]', { hasText: 'Spanish words' });
  await expect(hit).toBeVisible();
  await expect(hit.getByText('Spanish', { exact: true })).toBeVisible();
  await shot('3-search');

  await t.record(800);
  await page.getByRole('button', { name: /^All notes/ }).click();
  const rows = page.locator('li[aria-selected]');
  await expect(rows).toHaveCount(2);
  await rows
    .nth(0)
    .click({ position: { x: 360, y: 30 }, modifiers: ['Control'] });
  await rows
    .nth(1)
    .click({ position: { x: 360, y: 30 }, modifiers: ['Control'] });
  await expect(page.getByText('2 selected')).toBeVisible();
  await shot('4-selected');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete 2 notes?');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect
    .poll(() =>
      t.hooks((h) => h.store.pages.list().length + h.store.list().length),
    )
    .toBe(0);
  await expect(rows).toHaveCount(0);
});

test('pages: deleted while open falls back', async () => {
  await newPage('Doomed');
  await page.keyboard.type('soon gone');
  await expect.poll(body).toBe('soon gone');
  await expect(page.getByText('Saved')).toBeVisible();
  const id = await t.hooks((h) => h.store.pages.list()[0].id);
  await t.app.evaluate(async (_e, id) => {
    const h = (globalThis as any).__voiceNotes;
    await h.store.pages.deleteMany([id]);
    h.pagesChanged();
  }, id);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});
