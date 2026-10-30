import { expect, test } from '@playwright/test';
import { startAsrServer } from './fixtures/asr-server';
import { launch, type TestApp } from './launch';

const USER = '11111111-1111-4111-8111-111111111111';

let server: Awaited<ReturnType<typeof startAsrServer>>;
let t: TestApp;

test.beforeAll(async () => {
  server = await startAsrServer({ userId: USER });
});
test.afterAll(async () => {
  await server.close();
});
test.beforeEach(async () => {
  await server.setUsed(0);
});
test.afterEach(async () => {
  await t?.close();
});

/** Points the app at the fixture, then signs in (with no transcription set up, as a new account). */
async function signedIn() {
  t = await launch();
  await t.app.evaluate(
    (_e, { url, user }) => {
      const h = (globalThis as unknown as { __voiceNotes: Record<string, any> }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
      h.asr.useServer(url);
      h.asr.useToken(async () => 'test-token');
      h.account.setTestSession({ state: 'signed-in', userId: user, email: 'me@example.com', name: 'Test User', avatar: null });
    },
    { url: server.url, user: USER },
  );
  return t.dashboard;
}

const overlay = async (app: TestApp) => {
  for (let i = 0; i < 50; i++) {
    const p = app.app.windows().find((w) => w.url().includes('/overlay/'));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

/** A hands-free dictation through the real gesture → controller → overlay → function path. */
const dictate = async (page: TestApp['dashboard'], ms = 1500) => {
  await t.hooks((h) => h.dictationGesture.toggle());
  await page.waitForTimeout(ms);
  await t.hooks((h) => h.dictationGesture.toggle());
};

test('signing in makes Cloud the provider, and a dictation is transcribed by it', async () => {
  const page = await signedIn();
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.transcription.provider))).toBe('cloud');

  await t.hooks((h) => h.setForeground(() => ({ title: 'general | Slack', processName: 'slack.exe', pid: 1 })));
  await dictate(page);
  await expect.poll(() => t.hooks((h) => h.pasted), { timeout: 15_000 }).toEqual(['hello world']);
  expect(server.requests('transcribe')).toBe(1);
  const headers = server.lastHeaders('transcribe')!;
  expect(headers.authorization).toBe('Bearer test-token');
  expect(headers.apikey).toBeTruthy();
});

test('the Cloud card shows the month so far', async () => {
  const page = await signedIn();
  await server.setUsed(38 * 60);
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.transcription.provider))).toBe('cloud');
  await page.getByRole('button', { name: 'Transcription' }).click();
  await expect(page.getByRole('tab', { name: /Voice Notes Cloud/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Voice Notes Cloud', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/38 \/ 120 min this month · resets/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'In use' })).toBeDisabled();
  await page.screenshot({ path: '.superpowers/shots/cloud-card.png' });
});

test('when the free minutes are used up, the pill says so', async () => {
  const page = await signedIn();
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.transcription.provider))).toBe('cloud');
  await server.setUsed(7200);
  const pill = await overlay(t);
  await dictate(page);
  await expect(pill.getByTestId('pill')).toContainText('Free minutes used · resets', { timeout: 15_000 });
  expect(await t.hooks((h) => h.pasted)).toEqual([]);
});

test('signed out, the Cloud card asks to sign in', async () => {
  t = await launch();
  const page = t.dashboard;
  await page.getByRole('button', { name: 'Transcription' }).click();
  await page.getByRole('tab', { name: /Voice Notes Cloud/ }).click();
  await expect(page.getByText('Sign in to use Cloud')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});
