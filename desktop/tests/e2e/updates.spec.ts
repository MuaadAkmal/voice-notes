import { expect, test } from '@playwright/test';
import { launch } from './launch';

test('a downloaded update offers a restart, in the banner and in Settings', async () => {
  const { dashboard, hooks, close } = await launch();
  try {
    const restart = dashboard.getByRole('button', { name: 'Restart now' });
    await expect(restart).toHaveCount(0);

    await hooks((h) => h.updates.downloaded('9.9.9'));
    await expect(dashboard.getByRole('status').filter({ hasText: 'Version 9.9.9 is ready' })).toBeVisible();

    // Later hides the bar, but Settings still offers it.
    await dashboard.getByRole('button', { name: 'Later', exact: true }).click();
    await expect(restart).toHaveCount(0);
    await dashboard.getByRole('button', { name: /^Settings/ }).click();
    await expect(dashboard.getByText('Version 9.9.9 is ready.')).toBeVisible();
    await restart.click();
    await expect.poll(() => hooks((h) => h.updates.installs())).toBe(1);
  } finally {
    await close();
  }
});
