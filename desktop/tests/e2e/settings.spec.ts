import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;

test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});

test.afterEach(async () => {
  await t.close();
});

test('toggle knobs stay inside their track in both states', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const toggles = page.getByRole('switch');
  await expect(toggles.first()).toBeVisible();

  for (let i = 0; i < (await toggles.count()); i++) {
    const track = toggles.nth(i);
    for (let flip = 0; flip < 2; flip++) {
      const t0 = (await track.boundingBox())!;
      const k = (await track.locator('span').boundingBox())!;
      const on = (await track.getAttribute('aria-checked')) === 'true';
      console.log(`switch ${i} on=${on} track=[${t0.x},${t0.x + t0.width}] knob=[${k.x},${k.x + k.width}]`);
      expect(k.x).toBeGreaterThanOrEqual(t0.x);
      expect(k.x + k.width).toBeLessThanOrEqual(t0.x + t0.width + 0.5);
      // On → knob hugs the right end; off → the left end.
      if (on) expect(t0.x + t0.width - (k.x + k.width)).toBeLessThan(4);
      else expect(k.x - t0.x).toBeLessThan(4);
      await track.click();
      await page.waitForTimeout(250); // let the transform transition finish
    }
  }
  await page.screenshot({ path: '.superpowers/shots/settings-toggles.png' });
});
