import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import type { Note } from '../../src/shared/channels';

// Drives the production Vite build (`npm run package` emits .vite/) through the dev Electron binary:
// packaged builds disable the Node inspector fuse that Playwright needs.
type Hooks = {
  gesture: { toggle(): void; escape(): void };
  store: { list(): Note[]; absolutePath(n: Note): string };
};

let app: ElectronApplication;
let dashboard: Page;
let userData: string;

const hooks = <T>(fn: (h: Hooks) => T) =>
  app.evaluate((_electron, src) => {
    const h = (globalThis as unknown as { __voiceNotes: Hooks }).__voiceNotes;
    return new Function('h', `return (${src})(h)`)(h);
  }, fn.toString()) as Promise<T>;

test.beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-e2e-'));
  app = await electron.launch({
    args: ['.', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, VOICE_NOTES_TEST: '1', VOICE_NOTES_USER_DATA: userData },
  });
  dashboard = await app.waitForEvent('window', { predicate: (p) => p.url().includes('/dashboard/') });
  await dashboard.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
});

test('records a note via gesture and manages it from the dashboard', async () => {
  await hooks((h) => h.gesture.toggle()); // start + hands-free
  await dashboard.waitForTimeout(1500);
  await hooks((h) => h.gesture.toggle()); // stop
  await expect.poll(() => hooks((h) => h.store.list().length)).toBe(1);

  const file = await hooks((h) => h.store.absolutePath(h.store.list()[0]));
  expect(fs.statSync(file).size).toBeGreaterThan(0);

  await expect(dashboard.getByText('Today')).toBeVisible();
  await expect(dashboard.getByText(/^Voice note · \d\d:\d\d$/)).toBeVisible();

  // Playback through note://
  await dashboard.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(() => dashboard.evaluate(() => document.querySelector('audio')!.currentTime))
    .toBeGreaterThan(0);

  // Rename
  await dashboard.getByTitle('Click to rename').click();
  await dashboard.keyboard.type('hola');
  await dashboard.keyboard.press('Enter');
  await expect(dashboard.getByText('hola')).toBeVisible();
  await expect.poll(() => hooks((h) => h.store.list()[0].title)).toBe('hola');

  // Delete
  dashboard.once('dialog', (d) => d.accept());
  await dashboard.getByRole('button', { name: 'More' }).click();
  await dashboard.getByRole('button', { name: 'Delete' }).click();
  await expect(dashboard.getByText('No notes yet')).toBeVisible();
  expect(fs.existsSync(file)).toBe(false);
});

test('cancel does not create a note', async () => {
  await hooks((h) => h.gesture.toggle());
  await dashboard.waitForTimeout(500);
  await hooks((h) => h.gesture.escape());
  await dashboard.waitForTimeout(1000);
  expect(await hooks((h) => h.store.list().length)).toBe(0);
  expect(fs.readdirSync(path.join(userData, 'recordings'))).toEqual([]);
});
