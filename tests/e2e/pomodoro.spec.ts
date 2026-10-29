import { expect, type Page, test } from '@playwright/test';
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

test('the Pomodoro tab drives the pill timer, sets its lengths and counts finished sessions', async () => {
  t = await launch();
  const pill = await overlay(t);
  const d = t.dashboard;
  await d.getByRole('button', { name: /^Pomodoro/ }).click();
  const card = d.getByTestId('pomodoro-card');
  await expect(d.getByTestId('pomodoro-clock')).toHaveText('25:00');

  // A new focus length shows here and on the pill's chip.
  const focus = d.getByRole('spinbutton', { name: 'Focus length' });
  await focus.fill('40');
  await focus.press('Enter');
  await expect(d.getByTestId('pomodoro-clock')).toHaveText('40:00');
  await pill.getByTestId('pill').hover();
  await expect(pill.getByTestId('pomodoro')).toContainText('40:00');

  // Started from the dashboard, it runs on the pill; paused on the pill, the dashboard follows.
  await card.getByRole('button', { name: 'Start focus' }).click();
  await expect(pill.getByTestId('pomodoro')).toHaveAttribute('data-phase', 'focus');
  await expect(d.getByTestId('pomodoro-clock')).toHaveText(/39:5\d/, { timeout: 5000 });
  await pill.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('Paused');
  await card.getByRole('button', { name: 'Skip to break' }).click();
  await expect(pill.getByTestId('pomodoro')).toHaveAttribute('data-phase', 'break');
  await expect(card).toContainText('Break');
  await d.screenshot({ path: '.superpowers/shots/pomodoro-tab.png' });
  await card.getByRole('button', { name: 'Stop' }).click();
  await expect(card.getByRole('button', { name: 'Start focus' })).toBeVisible();

  // A finished focus session (reported by the pill) lands in today's stats, until reset.
  await pill.evaluate(() => window.overlayApi.pomodoroDone(25 * 60_000));
  await expect(card).toContainText('1 / 8');
  await d.getByRole('button', { name: 'Reset' }).click();
  await d.getByRole('alertdialog').getByRole('button', { name: 'Reset' }).click();
  await expect(card).toContainText('0 / 8');
});
