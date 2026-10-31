import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;

const signInAs = () =>
  t.app.evaluate((_e, info) => (globalThis as unknown as { __voiceNotes: { account: { setTestSession(i: unknown): void } } }).__voiceNotes.account.setTestSession(info), {
    state: 'signed-in',
    userId: 'u1',
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

test('signed out, the sidebar offers Sign in', async () => {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('Sign in under test never opens a real browser, and Cancel stops it', async () => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Waiting for browser…')).toBeVisible();
  await expect
    .poll(() => t.hooks((h) => h.openedExternal))
    .toEqual([expect.stringMatching(/^https:\/\/tpadlhyraittxehfvshc\.supabase\.co\/auth\/v1\/authorize\?/)]);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
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
  await expect(page.getByText('Sync this PC with your account?')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await page.screenshot({ path: `.superpowers/shots/account-${theme}.png` });
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign out? Your notes stay on this PC.')).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('muaad@example.com')).toBeHidden();
});
