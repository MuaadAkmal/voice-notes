import { expect, type Page, test } from '@playwright/test';
import type { RecordingSource } from '../../src/shared/channels';
import { launch, type TestApp } from './launch';

let t: TestApp;

const overlay = async (app: TestApp): Promise<Page> => {
  for (let i = 0; i < 50; i++) {
    const page = app.app.windows().find((w) => w.url().includes('/overlay/'));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('overlay window not found');
};

test.afterEach(async () => {
  await t.close();
});

test('shows "No sound" when the input is silent, and still saves', async () => {
  t = await launch({ fakeAudioFile: 'tests/e2e/fixtures/silence.wav' });
  const pill = await overlay(t);
  await t.hooks((h) => h.gesture.toggle());
  await expect(pill.getByText('No sound', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(pill.getByTitle('No sound — check mic/source')).toBeVisible();
  await pill.screenshot({ path: '.superpowers/shots/pill-nosound.png' });
  await t.hooks((h) => h.gesture.toggle());
  await expect.poll(() => t.hooks((h) => h.store.list().length)).toBe(1);
});

test('dragging the pill moves the window and remembers it, without recording', async () => {
  t = await launch();
  const pill = await overlay(t);
  const boundsOf = () =>
    t.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/overlay/'))!.getBounds(),
    );
  const before = await boundsOf();
  const box = (await pill.getByTestId('pill').boundingBox())!;
  await pill.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pill.mouse.down();
  await pill.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 30, { steps: 8 });
  await pill.mouse.up();
  await expect.poll(async () => (await boundsOf()).x).toBeLessThan(before.x);
  const saved = await t.dashboard.evaluate(() => window.dashboardApi.getSettings().then((s) => s.pillPosition));
  expect(saved).not.toBeNull();
  await pill.waitForTimeout(500);
  expect(await t.hooks((h) => h.store.list().length)).toBe(0);
  expect(await t.app.evaluate(() => (globalThis as any).__voiceNotes.controller.state)).toBe('idle');

  // Reset puts it back at bottom-centre.
  await t.dashboard.evaluate(() => window.dashboardApi.setSettings({ pillPosition: null }));
  await expect.poll(async () => (await boundsOf()).x).toBe(before.x);
});

test('a plain click on the pill still toggles hands-free recording', async () => {
  t = await launch();
  const pill = await overlay(t);
  await pill.getByTestId('pill').click();
  await expect.poll(() => t.app.evaluate(() => (globalThis as any).__voiceNotes.controller.state)).toBe('recording');
  await pill.waitForTimeout(800);
  await pill.getByTestId('pill').click();
  await expect.poll(() => t.hooks((h) => h.store.list().length)).toBe(1);
});

test('Add title on the pill names the note just saved, then gives focus back', async () => {
  t = await launch();
  const pill = await overlay(t);
  await t.record(1000);
  await expect(pill.getByRole('button', { name: /Add title/ })).toBeVisible();
  await pill.screenshot({ path: '.superpowers/shots/pill-saved.png' });
  await pill.getByRole('button', { name: /Add title/ }).click();
  await pill.waitForTimeout(200);
  await pill.screenshot({ path: '.superpowers/shots/pill-input.png' });
  const input = pill.getByLabel('Note title');
  await expect(input).toBeVisible();
  await input.fill('gracias');
  await input.press('Enter');
  await expect.poll(() => t.hooks((h) => h.store.list()[0].title)).toBe('gracias');
  await expect(pill.getByText('Saved ✓', { exact: true })).toBeVisible();
  const focusable = await t.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/overlay/'))!.isFocusable(),
  );
  expect(focusable).toBe(false);
  await pill.screenshot({ path: '.superpowers/shots/pill-titled.png' });
});

test('the × on a hands-free pill discards the recording', async () => {
  t = await launch();
  const pill = await overlay(t);
  await t.hooks((h) => h.gesture.toggle());
  await pill.waitForTimeout(800);
  await pill.getByTestId('pill').hover();
  await pill.getByRole('button', { name: 'Discard recording' }).click();
  await expect.poll(() => t.app.evaluate(() => (globalThis as any).__voiceNotes.controller.state)).toBe('idle');
  await pill.waitForTimeout(800);
  expect(await t.hooks((h) => h.store.list().length)).toBe(0);
});

test('waveform is drawn in the source colour while recording', async () => {
  t = await launch();
  const pill = await overlay(t);
  for (const source of ['mic', 'system', 'both'] as RecordingSource[]) {
    await t.dashboard.evaluate((s) => window.dashboardApi.setSettings({ recordingSource: s }), source);
    await t.hooks((h) => h.gesture.toggle());
    await expect(pill.locator('canvas')).toBeVisible();
    await pill.waitForTimeout(2200); // let the history fill
    await pill.screenshot({ path: `.superpowers/shots/pill-${source}.png` });
    await t.hooks((h) => h.gesture.escape());
    await pill.waitForTimeout(400);
  }
});
