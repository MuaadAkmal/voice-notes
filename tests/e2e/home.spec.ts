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

const cards = () => page.locator('main section');
const cardTitles = () => page.locator('main section h2');
const pageBody = (title: string) =>
  t
    .hooks((h) => h.store.pages.list())
    .then((ps) => ps.find((p) => p.title === title)?.body ?? null);

test('home: pin a page', async () => {
  await page.getByRole('button', { name: /^Inbox/ }).click();
  await page.getByRole('button', { name: 'New text note' }).click();
  await expect(page.getByLabel('Title')).toBeFocused();
  await page.keyboard.type('Shortcuts');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Keys');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] Ctrl+K link');
  await expect
    .poll(() => pageBody('Shortcuts'))
    .toBe('# Keys\n- [ ] Ctrl+K link');
  await page.getByRole('button', { name: 'Back' }).click();

  const row = page.locator('li[aria-selected]', { hasText: 'Shortcuts' });
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Pin to Home' }).click();
  await page.locator('aside').getByRole('button', { name: 'Home' }).click();

  const card = cards().filter({
    has: page.getByRole('heading', { name: 'Shortcuts' }),
  });
  await expect(card.locator('.cm-line.cm-md-h1')).toHaveText('Keys');
  await expect(card.locator('.cm-content')).not.toContainText('#');
  const box = card.locator('.cm-content input[type=checkbox]');
  await expect(box).toBeVisible();
  await setTheme('light');
  await shot('4-pinned-light');
  await setTheme('dark');
  await shot('4-pinned-dark');

  await box.click();
  await expect
    .poll(() => pageBody('Shortcuts'))
    .toBe('# Keys\n- [x] Ctrl+K link');
  await expect(card.locator('.cm-content input[type=checkbox]')).toBeChecked();

  await card.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Shortcuts');
  const unpin = page.getByRole('button', { name: 'Unpin from Home' });
  await expect(unpin).toBeVisible();
  await unpin.click();
  await expect(page.getByRole('button', { name: 'Pin to Home' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.dashboardApi.getSettings().then((s) => s.homeWidgets),
    ),
  ).toEqual([]);
});

test('home: reorder persists and delete prunes', async () => {
  // Seed two pages and a widget for each: a quick-add box, then a pinned page.
  const ids = await page.evaluate(async () => {
    const api = window.dashboardApi;
    const make = async (title: string, body: string) => {
      const p = await api.createPage(null);
      await api.renamePage(p.id, title);
      await api.setPageBody(p.id, body);
      return p.id;
    };
    const words = await make('New words', '');
    const keys = await make('Shortcuts', '# Keys\n- [ ] Ctrl+K link');
    await api.setSettings({
      homeWidgets: [
        {
          id: crypto.randomUUID(),
          type: 'quick-add',
          pageId: words,
          label: 'Learned today',
        },
        { id: crypto.randomUUID(), type: 'page', pageId: keys },
      ],
    });
    return { words, keys };
  });
  await expect(cardTitles()).toHaveText(['Learned today', 'Shortcuts']);

  await cards().nth(1).locator('header').dragTo(cards().nth(0));
  await expect(cardTitles()).toHaveText(['Shortcuts', 'Learned today']);
  await setTheme('light');
  await shot('5-reordered-light');
  await setTheme('dark');
  await shot('5-reordered-dark');

  await t.close();
  t = await launch({ userData: t.userData });
  page = t.dashboard;
  await expect(cardTitles()).toHaveText(['Shortcuts', 'Learned today']);

  await page.getByRole('button', { name: /^Inbox/ }).click();
  const row = page.locator('li[aria-selected]', { hasText: 'Shortcuts' });
  await row.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(row).toHaveCount(0);

  await page.locator('aside').getByRole('button', { name: 'Home' }).click();
  await expect(cardTitles()).toHaveText(['Learned today']);
  const widgets = await page.evaluate(() =>
    window.dashboardApi.getSettings().then((s) => s.homeWidgets),
  );
  expect(widgets.map((w) => w.pageId)).toEqual([ids.words]);
});
