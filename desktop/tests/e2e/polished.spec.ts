import { expect, test } from '@playwright/test';
import { startAsrServer } from './fixtures/asr-server';
import { startCommandsServer } from './fixtures/commands-server';
import { launch, type TestApp } from './launch';

const USER = '11111111-1111-4111-8111-111111111111';
const GEORGE = 'JBFqnCBsd6RMkjVDRZzb';
const VOICES = ['Sarah', 'George', 'Laura', 'Charlie', 'Matilda', 'Daniel'];

let asr: Awaited<ReturnType<typeof startAsrServer>>;
let commands: Awaited<ReturnType<typeof startCommandsServer>>;
let t: TestApp;

test.beforeAll(async () => {
  asr = await startAsrServer({ userId: USER });
  commands = await startCommandsServer({ userId: USER });
});
test.afterAll(async () => {
  await asr.close();
  await commands.close();
});
test.beforeEach(async () => {
  await asr.setUsed(0);
  asr.setPlan('free', 7200);
  asr.resetClone();
  asr.polished.clear();
});
test.afterEach(async () => {
  await t?.close();
});

/** Signed in against the fixtures; Cloud becomes the provider, so a recorded note is transcribed by itself. */
async function signedIn() {
  t = await launch();
  await t.app.evaluate(
    (_e, { asrUrl, commandsUrl, user }) => {
      const h = (globalThis as unknown as { __voiceNotes: Record<string, any> }).__voiceNotes; // eslint-disable-line @typescript-eslint/no-explicit-any
      h.asr.useServer(asrUrl);
      h.asr.useToken(async () => 'test-token');
      h.commands.useServer(commandsUrl);
      h.commands.useToken(async () => 'test-token');
      h.account.setTestSession({ state: 'signed-in', userId: user, email: 'me@example.com', name: 'Test User', avatar: null });
    },
    { asrUrl: asr.url, commandsUrl: commands.url, user: USER },
  );
  return t.dashboard;
}

/** The shared player's source as `<id>` plus its query (Chromium adds a slash after the id). */
const audioSource = (page: TestApp['dashboard']) =>
  page.evaluate(() => {
    const src = document.querySelector('audio')?.src;
    if (!src) return null;
    const u = new URL(src);
    return u.protocol === 'note:' ? u.hostname + u.search : src;
  });

test('the Voice tab lists six voices and saves the pick; Free is offered Upgrade', async () => {
  const page = await signedIn();
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: 'Voice' });
  await expect(group.getByRole('radio')).toHaveCount(6);
  for (const name of VOICES) await expect(group.getByRole('radio', { name })).toBeVisible();
  await expect(group.getByRole('radio', { name: 'My voice' })).toHaveCount(0);
  for (const name of VOICES) await expect(page.getByRole('button', { name: `Play ${name} sample` })).toBeVisible();
  // Main fetches the preview and hands the window a data: URL.
  const sample = await page.evaluate((id) => window.dashboardApi.voiceSample(id), GEORGE);
  expect(sample).toMatch(/^data:audio\//);
  await page.getByRole('button', { name: 'Play George sample' }).click();
  await expect(page.getByText('No sample available')).toHaveCount(0);

  await group.getByRole('radio', { name: 'George' }).click();
  await expect(group.getByRole('radio', { name: 'George' })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.dashboardApi.getSettings().then((s) => s.ttsVoice))).toBe(GEORGE);

  await expect(page.getByRole('button', { name: 'Upgrade' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clone my voice' })).toHaveCount(0);
  await page.screenshot({ path: '.superpowers/shots/voice-tab-free.png' });
  await page.getByRole('button', { name: 'Upgrade' }).click();
  await expect.poll(() => t.hooks((h) => h.openedExternal)).toContain('https://app.voicenote.cloud/account/');
});

test('on a paid plan cloning waits for consent, and too few notes says so', async () => {
  asr.setPlan('standard', 18000);
  const page = await signedIn();
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  const clone = page.getByRole('button', { name: 'Clone my voice' });
  await expect(clone).toBeDisabled();
  await page.getByRole('checkbox', { name: 'This is my own voice, and I agree to ElevenLabs creating a copy of it.' }).check();
  await expect(clone).toBeEnabled();
  await clone.click();
  await expect(page.getByText('Record a few more notes first')).toBeVisible();
});

test('a note with a transcript can be made into polished audio, then played in either version', async () => {
  const page = await signedIn();
  await t.record(1500);
  await expect.poll(() => t.hooks((h) => h.store.list()[0]?.transcript), { timeout: 15_000 }).toBe('hello world');
  const id = await t.hooks((h) => h.store.list()[0].id);

  await page.getByRole('button', { name: /^Inbox/ }).click();
  const make = page.getByRole('button', { name: 'Make polished audio' });
  await expect(make).toBeVisible();
  await expect(page.getByText('Uses about 1 min of Cloud minutes')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Polished' })).toHaveCount(0);

  await make.click();
  await expect(page.getByRole('radiogroup', { name: 'Version' })).toBeVisible({ timeout: 15_000 });
  expect(asr.polished.has(`${USER}/${id}.polished.mp3`)).toBe(true);
  await expect(make).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Original' })).toBeChecked();

  const polishedAt = await t.hooks((h) => h.store.list()[0].polishedAt);
  await page.getByRole('radio', { name: 'Polished' }).click();
  await expect(page.getByRole('radio', { name: 'Polished' })).toBeChecked();
  // The reading is not in the test bucket (the sync fixture isn't wired), so only the source is asserted.
  await expect.poll(() => audioSource(page)).toBe(`${id}?polished=1&v=${polishedAt}`);
  await page.mouse.move(1100, 700); // off the row, so the hover cross-fade has settled
  await page.waitForTimeout(400);
  await page.screenshot({ path: '.superpowers/shots/polished-note.png' });

  await page.getByRole('radio', { name: 'Original' }).click();
  await expect.poll(() => audioSource(page)).toBe(id);

  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete polished audio' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Version' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Make polished audio' })).toBeVisible();
});
