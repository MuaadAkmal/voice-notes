import { expect, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;

test.afterEach(async () => {
  await t.close();
});

const recordOver = async (title: string, noteTitle: string) => {
  await t.app.evaluate((_e, title) => {
    (globalThis as any).__voiceNotes.setForeground(() => ({ title, processName: 'chrome.exe', pid: 1 }));
  }, title);
  await t.record(700);
  await t.app.evaluate((_e, noteTitle) => {
    const s = (globalThis as any).__voiceNotes.store;
    s.rename(s.list()[0].id, noteTitle);
  }, noteTitle);
};

test('search across folders, filter by show, star a note', async () => {
  t = await launch();
  const d = t.dashboard;
  await recordOver('La Casa de Papel | Netflix - Google Chrome', '¿Qué pasó?');
  await recordOver('Dark | Netflix - Google Chrome', 'gracias');
  await recordOver('La Casa de Papel | Netflix - Google Chrome', 'tranquilo');
  const rows = d.locator('li[aria-selected]');
  await expect(rows).toHaveCount(3);

  // Accent-insensitive search over titles.
  await d.getByLabel('Search notes').fill('que paso');
  await expect(rows).toHaveCount(1);
  await expect(d.getByRole('heading', { name: 'Search' })).toBeVisible();
  await expect(d.getByText('1 note across all folders')).toBeVisible();

  // Show filter: chips list each show; search the show name too.
  await d.getByLabel('Search notes').fill('');
  await d.getByLabel('Filter by show').click();
  await d.getByRole('option', { name: /La Casa de Papel/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByText('La Casa de Papel')).toBeVisible();
  await d.screenshot({ path: '.superpowers/shots/search-show.png' });

  // Star one note, then the Starred view lists it.
  await rows.first().hover();
  await rows.first().getByRole('button', { name: 'Star', exact: true }).click();
  await expect(rows.first().getByRole('button', { name: 'Unstar' })).toBeVisible();
  await d.getByRole('button', { name: 'Clear filters' }).click();
  await d.locator('aside').getByRole('button', { name: /Starred/ }).click();
  await expect(d.getByRole('heading', { name: 'Starred' })).toBeVisible();
  await expect(rows).toHaveCount(1);

  // Rewind filter with no rewinds: empty state.
  await d.getByLabel('Filter by source').click();
  await d.getByRole('option', { name: 'Rewinds' }).click();
  await expect(d.getByText('No notes match')).toBeVisible();
  await d.screenshot({ path: '.superpowers/shots/search-empty.png' });
});

test('edit a note\'s show label from its menu', async () => {
  t = await launch();
  const d = t.dashboard;
  await recordOver('Some Video - YouTube - Google Chrome', 'hola');
  const row = d.locator('li[aria-selected]').first();
  await expect(row.getByText('Some Video')).toBeVisible();
  await row.getByRole('button', { name: 'More' }).click();
  await d.getByRole('menuitem', { name: 'Edit show' }).click();
  const input = row.getByLabel('Show');
  await input.fill('Dark');
  await input.press('Enter');
  await expect.poll(() => t.hooks((h) => h.store.list()[0].show)).toBe('Dark');
  await expect(row.getByText('Dark')).toBeVisible();
});
