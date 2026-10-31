import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, type Page, test } from '@playwright/test';
import { launch, type TestApp } from './launch';

let t: TestApp;
let page: Page;
let whisper: http.Server;

test.beforeAll(async () => {
  // A fake Whisper server that always hears the reminder.
  whisper = http.createServer((req, res) => {
    req.resume();
    req.on('end', () =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: ' Pixie, remind me to call mom in 10 minutes.' })),
    );
  });
  await new Promise<void>((r) => whisper.listen(0, '127.0.0.1', r));
});
test.afterAll(() => {
  whisper.close();
});
test.beforeEach(async () => {
  t = await launch();
  page = t.dashboard;
});
test.afterEach(async () => {
  await t.close();
});

test('a "remind me" dictation sets a reminder that fires and snoozes', async () => {
  const baseUrl = `http://127.0.0.1:${(whisper.address() as AddressInfo).port}/v1`;
  await page.evaluate((u) => window.dashboardApi.setSettings({ transcription: { provider: 'server', baseUrl: u, model: 'whisper', localModel: null } }), baseUrl);
  const overlay = t.app.windows().find((w) => w.url().includes('/overlay/'))!;

  await t.hooks((h) => h.dictationGesture.toggle());
  await page.waitForTimeout(1500);
  await t.hooks((h) => h.dictationGesture.toggle());

  await expect(overlay.getByTestId('pill')).toContainText('Reminder · call mom', { timeout: 10_000 });
  expect(await t.hooks((h) => h.pasted)).toEqual([]);

  await page.getByRole('button', { name: /^Reminders/ }).click();
  await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
  await expect(page.getByText('call mom', { exact: true })).toBeVisible();
  await expect(page.getByText('· in 10 min')).toBeVisible();

  // Eleven minutes later the scheduler fires it once.
  await t.hooks((h) => {
    const g = globalThis as unknown as { remindersAt: number };
    g.remindersAt = Date.now() + 11 * 60_000;
    h.reminders.setNow(() => g.remindersAt);
    h.reminders.check();
    h.reminders.check();
  });
  expect(await t.hooks((h) => h.reminders.fired.map((f) => [f.text, f.missed]))).toEqual([['call mom', false]]);
  await expect(page.getByText('· Due')).toBeVisible();
  await page.screenshot({ path: '.superpowers/shots/reminders.png' });

  // Snooze: due ten minutes after "now", and pending again.
  await page.getByRole('button', { name: 'Snooze' }).click();
  await expect(page.getByText('· Due')).toBeHidden();
  const [r] = await t.hooks((h) => h.reminders.service.list());
  expect(r).toMatchObject({ text: 'call mom', status: 'pending', firedAt: null });
  const at = await t.hooks(() => (globalThis as unknown as { remindersAt: number }).remindersAt);
  expect(r.dueAt).toBe(at + 10 * 60_000);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Past 7 days')).toBeVisible();
});

test('typed in the tab; no time heard goes to Quick notes; the Home card lists it', async () => {
  await page.getByRole('button', { name: /^Reminders/ }).click();
  const box = page.getByRole('textbox', { name: 'New reminder' });
  await box.fill('water plants tomorrow at 9 am');
  await box.press('Enter');
  await expect(page.getByText('Reminder · water plants · Tomorrow 9:00 AM')).toBeVisible();
  await expect(page.getByText('water plants', { exact: true })).toBeVisible();

  await box.fill('buy milk');
  await box.press('Enter');
  await expect(page.getByText('No time heard → Quick notes')).toBeVisible();
  expect(await t.hooks((h) => h.reminders.service.list().length)).toBe(1);

  await page.getByRole('button', { name: /^Home/ }).click();
  await page.getByRole('button', { name: 'Add widget' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reminders', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add widget' }).click();
  await expect(page.getByText('Upcoming reminders')).toBeVisible();
  await expect(page.getByText('water plants', { exact: true })).toBeVisible();
});
