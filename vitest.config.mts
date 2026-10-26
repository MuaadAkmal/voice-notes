import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // Each worker is a whole Electron process (better-sqlite3 needs Electron's ABI) and the Postgres
    // tests add PGlite: one per CPU thread starved a 16 GB machine into failed worker starts.
    maxWorkers: 6,
  },
});
