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
