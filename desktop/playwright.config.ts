import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  // Keep a trace when something fails, so intermittent failures leave evidence.
  use: { trace: 'retain-on-failure' },
});
