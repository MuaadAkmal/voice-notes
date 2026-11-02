import { expect, type Page, test } from '@playwright/test';
import { launch, TEST_USER, type TestApp } from './launch';

let t: TestApp;
let page: Page;

const signInAs = () =>
  t.app.evaluate((_e, info) => (globalThis as unknown as { __voiceNotes: { account: { setTestSession(i: unknown): void } } }).__voiceNotes.account.setTestSession(info), {
    state: 'signed-in',
    userId: TEST_USER,
    email: 'muaad@example.com',
    name: 'Muaad Akmal',
    avatar: null,
  });

async function setTheme(theme: 'light' | 'dark') {
  await t.app.evaluate(({ nativeTheme }, th) => {
    nativeTheme.themeSource = th;
  }, theme);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');
  await page.waitForTimeout(250);
}

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

test('signed in, the chip shows who; the Account page signs out', async () => {
  await signInAs();
  const chip = page.getByRole('button', { name: /^Account: Muaad Akmal/ });
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Muaad');
  await expect(chip).toContainText('MA');
  await chip.click();
  await expect(page.getByText('muaad@example.com')).toBeVisible();
  await expect(page.getByText('Signed in with Google')).toBeVisible();
  await expect(page.getByText('Sync', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await page.screenshot({ path: `.superpowers/shots/account-${theme}.png` });
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alertdialog').getByText('Sign out?')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => t.hooks((h) => h.relaunches)).toEqual([null]); // back to the sign-in screen
});
