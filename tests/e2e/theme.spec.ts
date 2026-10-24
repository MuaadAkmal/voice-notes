import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
const shot = (name: string) => page.screenshot({ path: `.superpowers/shots/theme-${name}.png` });
const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

test('appearance switches between dark and light and persists', async () => {
  await t.record(1200);
  await page.getByRole('button', { name: 'Settings' }).click();
  const group = page.getByRole('group', { name: 'Appearance' });

  await group.getByRole('button', { name: 'Dark' }).click();
  await expect.poll(isDark).toBe(true);
  await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  expect(await t.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
  await page.waitForTimeout(250);
  await shot('dark-settings');

  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await page.waitForTimeout(250);
  await shot('dark-inbox-menu');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await group.getByRole('button', { name: 'Light' }).click();
  await expect.poll(isDark).toBe(false);
  expect(await t.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
});
