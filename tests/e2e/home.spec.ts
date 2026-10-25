import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
// Visual checkpoints for manual review (git-ignored).
const shot = (name: string) =>
  page.screenshot({ path: `.superpowers/shots/home-${name}.png` });
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

test('home: default view and quick add', async () => {
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Home' }),
  ).toHaveAttribute('aria-current', 'page');
  await setTheme('light');
  await shot('1-empty');

  await page.getByRole('button', { name: 'Add a quick-add box' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Page' }).click();
  await page.getByRole('option', { name: 'New page…' }).click();
  await expect(dialog.getByLabel('New page name')).toHaveValue('New words');
  await expect(dialog.getByLabel('Label')).toHaveValue('Learned today');
  await shot('2-dialog');
  await dialog.getByRole('button', { name: 'Add widget' }).click();
  await expect(dialog).toBeHidden();

  const input = page.getByLabel('Add entry to Learned today');
  await input.click();
  await input.fill('hola: hello');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill('adiós: bye');
  await input.press('Enter');

  const card = page.locator('section', { has: input });
  await expect(card.getByRole('listitem')).toHaveText([
    'hola: hello',
    'adiós: bye',
  ]);
  await expect(card.getByText('Today', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      t.hooks(
        (h) => h.store.pages.list().find((p) => p.title === 'New words')?.body,
      ),
    )
    .toMatch(/^## \d{1,2} [A-Z][a-z]{2} \d{4}\n- hola: hello\n- adiós: bye\n$/);
  await shot('3-light');
  await setTheme('dark');
  await shot('3-dark');

  await card.getByRole('button', { name: 'New words' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('New words');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  // Rename the box from its ⋯ menu; Escape cancels a second rename.
  const rename = async (label: string, key: 'Enter' | 'Escape') => {
    await page.getByRole('button', { name: 'Widget options' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const field = page.getByLabel('Label');
    await expect(field).toBeFocused();
    await field.fill(label);
    await field.press(key);
    await expect(field).toBeHidden();
  };
  await rename('Words', 'Enter');
  await expect(page.getByLabel('Add entry to Words')).toBeVisible();
  await rename('Nope', 'Escape');
  await page.waitForTimeout(300);
  await expect(page.getByLabel('Add entry to Words')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nope' })).toHaveCount(0);

  // Remove: back to the empty state; the page itself stays.
  await page.getByRole('button', { name: 'Widget options' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByText('Nothing on Home yet')).toBeVisible();
  expect(
    await t.hooks((h) =>
      h.store.pages.list().some((p) => p.title === 'New words'),
    ),
  ).toBe(true);
});
