import fs from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { startSyncServer } from './fixtures/sync-server';
import { launch, type TestApp } from './launch';

const USER = '11111111-1111-4111-8111-111111111111';
let server: Awaited<ReturnType<typeof startSyncServer>>;
let a: TestApp;
let b: TestApp;

/** Points the app at the local sync server, signs it in as USER, and turns sync on from the prompt. */
async function connect(t: TestApp) {
  await t.app.evaluate(
    (_e, { url, user }) => {
      const h = (globalThis as unknown as { __voiceNotes: Record<string, any> }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
      h.sync.useServer(url);
      h.sync.useToken(async () => 'test-token');
      h.account.setTestSession({ state: 'signed-in', userId: user, email: 'me@example.com', name: 'Test User', avatar: null });
    },
    { url: server.url, user: USER },
  );
  const page = t.dashboard;
  await page.getByRole('button', { name: /^Account: Test User/ }).click();
  await expect(page.getByText('Sync this PC with your account?')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/^Synced/)).toBeVisible({ timeout: 15_000 });
}

const syncNow = (t: TestApp) => t.app.evaluate(() => (globalThis as unknown as { __voiceNotes: { sync: { now(): void } } }).__voiceNotes.sync.now());

/** Syncs both until `check` holds on `page` (each round: push from the writer, pull on the reader). */
async function until(page: Page, check: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        await syncNow(a);
        await syncNow(b);
        return check();
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe(true);
}

test.beforeAll(async () => {
  server = await startSyncServer(USER);
});
test.afterAll(async () => {
  await server.close();
});
test.beforeEach(async () => {
  a = await launch();
  b = await launch();
});
test.afterEach(async () => {
  await a.close();
  await b.close();
});

test('two PCs stay in step: notes, an open page, and the switch', async () => {
  await a.record(1500);
  const noteId = await a.hooks((h) => h.store.list()[0].id);
  await connect(a);
  await connect(b);
  for (const theme of ['light', 'dark'] as const) {
    await a.app.evaluate(({ nativeTheme }, th) => void (nativeTheme.themeSource = th), theme);
    await a.dashboard.waitForTimeout(300);
    await a.dashboard.screenshot({ path: `.superpowers/shots/sync-card-${theme}.png` });
  }

  // A rename on A shows up on B.
  await a.app.evaluate((_e, id) => (globalThis as unknown as { __voiceNotes: any }).__voiceNotes.store.rename(id, 'Renamed on A'), noteId); // eslint-disable-line @typescript-eslint/no-explicit-any
  await until(b.dashboard, async () => (await b.hooks((h) => h.store.list().map((n) => n.title))).includes('Renamed on A'));
  await b.dashboard.getByRole('button', { name: /^Inbox/ }).click();
  await expect(b.dashboard.getByText('Renamed on A')).toBeVisible();

  // B adds to a page that A has open: A's open page shows it.
  const pageId = await a.app.evaluate(() => {
    const h = (globalThis as unknown as { __voiceNotes: any }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = h.store.pages.create(null);
    h.store.pages.rename(p.id, 'Shared plan');
    h.store.pages.setBody(p.id, 'intro');
    h.pagesChanged();
    return p.id as string;
  });
  await until(b.dashboard, async () => (await b.hooks((h) => h.store.pages.list().map((p) => p.title))).includes('Shared plan'));
  await a.dashboard.getByRole('button', { name: /^Inbox/ }).click();
  await a.dashboard.locator('li', { hasText: 'Shared plan' }).getByRole('button', { name: 'Open' }).click();
  await expect(a.dashboard.locator('.cm-content')).toContainText('intro');
  await b.app.evaluate((_e, id) => (globalThis as unknown as { __voiceNotes: any }).__voiceNotes.store.pages.appendEntry(id, 'added on B'), pageId); // eslint-disable-line @typescript-eslint/no-explicit-any
  await until(a.dashboard, async () => (await a.dashboard.locator('.cm-content').textContent())?.includes('added on B') ?? false);

  // Typing on A while B rewrites the page: nobody's text is lost.
  await a.dashboard.locator('.cm-content').click();
  await b.app.evaluate((_e, id) => (globalThis as unknown as { __voiceNotes: any }).__voiceNotes.store.pages.setBody(id, 'rewritten on B'), pageId); // eslint-disable-line @typescript-eslint/no-explicit-any
  await syncNow(b);
  await syncNow(a); // arrives while A is typing: A's editor keeps its text
  await a.dashboard.keyboard.press('End');
  await a.dashboard.keyboard.type(' typed on A');
  await a.dashboard.locator('.cm-content').blur(); // saves
  const bodies = async (t: TestApp) => (await t.hooks((h) => h.store.pages.list().map((p) => p.body))).join('\n');
  await until(b.dashboard, async () => {
    const all = await bodies(b);
    return all.includes('rewritten on B') && all.includes('typed on A');
  });

  // Switched off on A: an edit waits; switched back on, it goes across.
  await a.dashboard.getByRole('button', { name: /^Account: Test User/ }).click();
  await a.dashboard.getByRole('switch', { name: 'Sync this PC' }).click();
  await expect(a.dashboard.getByRole('switch', { name: 'Sync this PC' })).toHaveAttribute('aria-checked', 'false');
  await a.app.evaluate((_e, id) => (globalThis as unknown as { __voiceNotes: any }).__voiceNotes.store.rename(id, 'Made while off'), noteId); // eslint-disable-line @typescript-eslint/no-explicit-any
  await syncNow(a);
  await syncNow(b);
  await b.dashboard.waitForTimeout(1000);
  expect(await b.hooks((h) => h.store.list().map((n) => n.title))).not.toContain('Made while off');
  await a.dashboard.getByRole('switch', { name: 'Sync this PC' }).click();
  await until(b.dashboard, async () => (await b.hooks((h) => h.store.list().map((n) => n.title))).includes('Made while off'));
});

/** Like `hooks`, with one argument passed through. */
const hook = <T>(t: TestApp, fn: (h: any, arg: string) => T, arg: string) => // eslint-disable-line @typescript-eslint/no-explicit-any
  t.app.evaluate(
    (_e, { src, value }) => new Function('h', 'a', `return (${src})(h, a)`)((globalThis as unknown as { __voiceNotes: unknown }).__voiceNotes, value),
    { src: fn.toString(), value: arg },
  ) as Promise<Awaited<T>>;

// A 1×1 PNG, so the image actually decodes on B.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a note recorded on A plays on B', async () => {
  await a.record(1500);
  const noteId = await a.hooks((h) => h.store.list()[0].id);
  await connect(a);
  await connect(b);
  const key = `${USER}/${noteId}.webm`;
  await until(b.dashboard, async () => !!server.bucket.get('audio', key) && (await b.hooks((h) => h.store.list().length)) > 0);

  await b.dashboard.getByRole('button', { name: /^Inbox/ }).click();
  const row = b.dashboard.locator('li', { has: b.dashboard.getByLabel('In your account') });
  await expect(row).toHaveCount(1);
  await b.dashboard.screenshot({ path: '.superpowers/shots/sync-remote-note.png' });
  await row.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => hook(b, (h, id) => h.store.get(id)?.status, noteId)).toBe('ok');
  const fileOf = (t: TestApp) => hook(t, (h, id) => h.store.absolutePath(h.store.get(id)) as string, noteId);
  expect(fs.readFileSync(await fileOf(b))).toEqual(fs.readFileSync(await fileOf(a)));
  expect(Buffer.from(server.bucket.get('audio', key)!)).toEqual(fs.readFileSync(await fileOf(a)));
  await expect(b.dashboard.getByLabel('In your account')).toHaveCount(0);
});

test('an image pasted on A shows on B', async () => {
  await connect(a);
  await connect(b);
  const name = await a.app.evaluate(async (_e, png) => {
    const h = (globalThis as unknown as { __voiceNotes: any }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
    const url = await h.store.pages.saveImage(Buffer.from(png, 'base64'), 'png');
    const p = h.store.pages.create(null);
    h.store.pages.rename(p.id, 'Picture page');
    h.store.pages.setBody(p.id, `before\n\n![dot](${url})\n\nafter`);
    h.pagesChanged();
    return (url as string).slice('vn-image://'.length);
  }, PNG_1PX);
  await until(b.dashboard, async () => !!server.bucket.get('image', `${USER}/${name}`) && (await b.hooks((h) => h.store.pages.list().map((p) => p.title))).includes('Picture page'));

  await b.dashboard.getByRole('button', { name: /^Inbox/ }).click();
  await b.dashboard.locator('li', { hasText: 'Picture page' }).getByRole('button', { name: 'Open' }).click();
  const img = b.dashboard.locator('.cm-content img');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('deleting a note on A removes its audio from the server', async () => {
  await a.record(1500);
  const noteId = await a.hooks((h) => h.store.list()[0].id);
  await connect(a);
  const key = `${USER}/${noteId}.webm`;
  await expect.poll(async () => {
    await syncNow(a);
    return !!server.bucket.get('audio', key);
  }, { timeout: 20_000, intervals: [500] }).toBe(true);
  await hook(a, (h, id) => h.store.delete(id), noteId);
  await expect.poll(async () => {
    await syncNow(a);
    return !!server.bucket.get('audio', key);
  }, { timeout: 20_000, intervals: [500] }).toBe(false);
});