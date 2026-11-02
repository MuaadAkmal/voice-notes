import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp | null = null;

/** Closes the app and waits for its process to end, so its files can be moved. */
async function closeAndWait(app: TestApp) {
  const proc = app.app.process();
  const exited = new Promise<void>((resolve) => (proc.exitCode !== null ? resolve() : proc.once('exit', () => resolve())));
  await app.close();
  await exited;
}
test.afterEach(async () => {
  await t?.close();
  t = null;
});

const signIn = (app: TestApp, userId: string) =>
  app.app.evaluate(
    (_e, id) =>
      (globalThis as unknown as { __voiceNotes: { account: { setTestSession(i: unknown): void } } }).__voiceNotes.account.setTestSession({
        state: 'signed-in',
        userId: id,
        email: 'me@example.com',
        name: 'Test User',
        avatar: null,
      }),
    userId,
  );

test('signed out: only the sign-in screen', async () => {
  t = await launch({ profile: null });
  await expect(t.dashboard.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(t.app.windows().some((w) => w.url().includes('/overlay/'))).toBe(false); // no pill
  expect(await t.hooks((h) => typeof (h as { store?: unknown }).store)).toBe('undefined'); // no library open
  for (const theme of ['light', 'dark'] as const) {
    await t.app.evaluate(({ nativeTheme }, th) => void (nativeTheme.themeSource = th), theme);
    await t.dashboard.waitForTimeout(300);
    await t.dashboard.screenshot({ path: `.superpowers/shots/signin-${theme}.png` });
  }
});

test('Sign in under test never opens a real browser, and Cancel stops it', async () => {
  t = await launch({ profile: null });
  await t.dashboard.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(t.dashboard.getByText('Waiting for browser…')).toBeVisible();
  await expect
    .poll(() => t!.hooks((h) => h.openedExternal))
    .toEqual([expect.stringMatching(/^https:\/\/tpadlhyraittxehfvshc\.supabase\.co\/auth\/v1\/authorize\?/)]);
  await t.dashboard.getByRole('button', { name: 'Cancel' }).click();
  await expect(t.dashboard.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

test('sign in relaunches into the profile', async () => {
  t = await launch({ profile: null });
  await signIn(t, 'a');
  await expect.poll(() => t!.hooks((h) => h.relaunches)).toEqual(['a']);
});

test('two accounts on one PC see only their own notes', async () => {
  t = await launch({ profile: 'a' });
  const { userData } = t;
  await t.record(1500);
  expect(await t.hooks((h) => h.store.list().length)).toBe(1);
  await t.close();

  t = await launch({ userData, profile: 'b' });
  expect(await t.hooks((h) => h.store.list().length)).toBe(0);
  await t.dashboard.getByRole('button', { name: /^Inbox/ }).click();
  await expect(t.dashboard.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(t.dashboard.getByRole('button', { name: 'Play' })).toHaveCount(0); // A's voice note isn't here
  await t.close();

  t = await launch({ userData, profile: 'a' });
  expect(await t.hooks((h) => h.store.list().length)).toBe(1);
});

test('sign out relaunches signed out', async () => {
  t = await launch({ profile: 'a' });
  await signIn(t, 'a');
  await t.dashboard.getByRole('button', { name: /^Account: Test User/ }).click();
  await t.dashboard.getByRole('button', { name: 'Sign out' }).click();
  await t.dashboard.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => t!.hooks((h) => h.relaunches)).toEqual([null]);
});

test('upgrade: a root-level library opens as its owner’s profile', async () => {
  t = await launch({ profile: 'old' });
  const { userData } = t;
  await t.record(1500);
  await closeAndWait(t);
  t = null;

  // Put it back the way a build from before profiles kept it: everything at the root, one settings.json.
  const dir = path.join(userData, 'profiles', 'old');
  for (const f of fs.readdirSync(dir)) if (f !== 'profile.json') fs.renameSync(path.join(dir, f), path.join(userData, f));
  const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ...read(path.join(userData, 'pc.json')), ...read(path.join(dir, 'profile.json')) }));
  fs.rmSync(path.join(userData, 'profiles'), { recursive: true });
  fs.rmSync(path.join(userData, 'pc.json'));

  t = await launch({ userData, profile: 'old' });
  expect(await t.hooks((h) => h.store.list().length)).toBe(1);
  expect(fs.existsSync(path.join(userData, 'profiles', 'old', 'voice-notes.sqlite'))).toBe(true);
  expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(false);
});
