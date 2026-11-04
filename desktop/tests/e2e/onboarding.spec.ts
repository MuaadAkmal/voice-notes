import { expect, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

// A new account's first launch. e2e has no sync server, so the hook plays "the first sync went
// through" (onboarding.start), as main does after a real one.

let t: TestApp;
test.afterEach(async () => {
  await t?.close();
});

const start = () => t.hooks((h) => (h as unknown as { onboarding: { start(): void } }).onboarding.start());
const titles = () => t.hooks((h) => h.store.pages.list().map((p) => p.title));
const onboarded = () => t.dashboard.evaluate(() => window.dashboardApi.getSettings().then((s) => s.onboarded));

test('a new account gets starter pages and the first-run screen; a note shows on the hotkey step', async () => {
  t = await launch();
  const page = t.dashboard;
  await start();
  const dialog = page.getByRole('dialog', { name: 'Welcome to Voice Notes' });
  await expect(dialog).toBeVisible();
  expect(await titles()).toEqual(expect.arrayContaining(['Grocery list', 'Spanish', 'YouTube']));
  await page.screenshot({ path: '.superpowers/shots/onboarding-welcome.png' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await expect(dialog.getByRole('heading', { name: 'Check your mic' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('radio', { name: /Voice Notes Cloud/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('radio', { name: /Built-in/ }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Record your first note' })).toBeVisible();
  await t.record(1200);
  await expect(dialog.getByText('Saved ✓')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Talk to your lists' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'What you can say' })).toBeVisible();
  await expect(dialog.getByText('Alt+Win+Shift')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/onboarding-say.png' });
  await dialog.getByRole('button', { name: 'Start using Voice Notes' }).click();

  await expect(dialog).toBeHidden();
  expect(await onboarded()).toBe(true);
  // Built-in was picked: it lands on the Transcription page to set it up.
  await expect(page.getByRole('heading', { name: 'Transcription' })).toBeVisible();
});

test('Skip ends it at once, and it never comes back', async () => {
  t = await launch();
  await start();
  const dialog = t.dashboard.getByRole('dialog', { name: 'Welcome to Voice Notes' });
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog).toBeHidden();
  expect(await onboarded()).toBe(true);
  const before = (await titles()).length;
  await start();
  await t.dashboard.waitForTimeout(300);
  await expect(dialog).toBeHidden();
  expect((await titles()).length).toBe(before); // no second set of starter pages
});

test('an account that already has notes is never onboarded', async () => {
  t = await launch();
  await t.record(1200);
  await start();
  await t.dashboard.waitForTimeout(300);
  await expect(t.dashboard.getByRole('dialog', { name: 'Welcome to Voice Notes' })).toBeHidden();
  expect(await onboarded()).toBe(true);
  expect(await titles()).not.toContain('Grocery list');
});
