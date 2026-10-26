import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
const REDDIT = 'https://www.reddit.com/r/x/comments/1/a/';

const overlay = async (app: TestApp): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const page = app.app.windows().find((w) => w.url().includes('/overlay/'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

/** A browser-style drag of a Reddit link onto the pill: enter, then optionally drop. */
const dragLink = (pill: Page, phase: 'enter' | 'drop') =>
  pill.evaluate(
    ({ url, phase }) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', url);
      dt.setData('text/uri-list', url);
      dt.setData('text/html', `<a href="${url}">The duality of this sub is insame</a>`);
      const fire = (type: string) => window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      if (phase === 'enter') fire('dragenter');
      else {
        fire('dragover');
        fire('drop');
      }
    },
    { url: REDDIT, phase },
  );

const laterBody = () => t.hooks((h) => h.store.pages.list().find((p) => p.title === 'Review later')?.body ?? null);

test.afterEach(async () => {
  await t.close();
});

test('drops a link onto the pill', async () => {
  t = await launch();
  await t.hooks((h) => h.setForeground(() => null));
  const pill = await overlay(t);
  await expect.poll(laterBody).toBe('');
  await dragLink(pill, 'enter');
  await expect(pill.getByText('Drop to save for later')).toBeVisible();
  await dragLink(pill, 'drop');
  await expect(pill.getByText('Saved for later ✓')).toBeVisible();
  await expect.poll(laterBody).toContain(`- [ ] [The duality of this sub is insame](${REDDIT})`);
  await pill.screenshot({ path: '.superpowers/shots/later-saved.png' });
});

test('ignores drops while recording', async () => {
  t = await launch();
  const pill = await overlay(t);
  await t.hooks((h) => h.gesture.toggle());
  await expect(pill.getByTitle('Discard recording')).toBeAttached();
  await dragLink(pill, 'enter');
  await dragLink(pill, 'drop');
  await expect(pill.getByText('Drop to save for later')).toHaveCount(0);
  await pill.waitForTimeout(500);
  expect(await laterBody()).toBe('');
  await t.hooks((h) => h.gesture.toggle());
});

test('Review later is built in', async () => {
  t = await launch();
  const page = t.dashboard;
  const card = page.locator('main section').filter({ has: page.locator('h2', { hasText: 'Review later' }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Widget options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Size' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Inbox/ }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'Review later' });
  await expect(row.getByText('Built-in')).toBeVisible();
  await row.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Pin to Home|Unpin from Home/ })).toHaveCount(0);
});

test('main keeps the page and its card even if asked to drop them', async () => {
  t = await launch();
  const page = t.dashboard;
  const id = await t.hooks((h) => h.store.pages.list().find((p) => p.title === 'Review later')!.id);
  await page.evaluate(async (id) => {
    await window.dashboardApi.deletePages([id]);
    await window.dashboardApi.setSettings({ homeWidgets: [] });
  }, id);
  expect(await t.hooks((h) => h.store.pages.list().some((p) => p.title === 'Review later'))).toBe(true);
  await page.getByRole('button', { name: 'Home' }).first().click();
  await expect(page.locator('main section h2', { hasText: 'Review later' })).toBeVisible();
});
