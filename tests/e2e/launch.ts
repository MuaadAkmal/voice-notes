import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Folder, Note } from '../../src/shared/channels';

// Drives the production Vite build (`npm run package` emits .vite/) through the dev Electron binary:
// packaged builds disable the Node inspector fuse that Playwright needs.
export type Hooks = {
  gesture: { toggle(): void; escape(): void };
  store: { list(): Note[]; absolutePath(n: Note): string; folders: { list(): Folder[] } };
};

export type TestApp = {
  app: ElectronApplication;
  dashboard: Page;
  userData: string;
  hooks: <T>(fn: (h: Hooks) => T) => Promise<T>;
  record: (ms?: number) => Promise<void>;
  close: () => Promise<void>;
};

export async function launch(): Promise<TestApp> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-e2e-'));
  const app = await electron.launch({
    args: ['.', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    // Playwright emulates prefers-color-scheme: light by default; let nativeTheme decide, as in the real app.
    colorScheme: null,
    env: { ...process.env, VOICE_NOTES_TEST: '1', VOICE_NOTES_USER_DATA: userData },
  });
  const dashboard = await app.waitForEvent('window', { predicate: (p) => p.url().includes('/dashboard/') });
  await dashboard.waitForLoadState('domcontentloaded');

  const hooks = <T>(fn: (h: Hooks) => T) =>
    app.evaluate((_electron, src) => {
      const h = (globalThis as unknown as { __voiceNotes: Hooks }).__voiceNotes;
      return new Function('h', `return (${src})(h)`)(h);
    }, fn.toString()) as Promise<T>;

  /** Hands-free record for `ms` through the real gesture → controller → overlay path. */
  const record = async (ms = 1500) => {
    const before = await hooks((h) => h.store.list().length);
    await hooks((h) => h.gesture.toggle());
    await dashboard.waitForTimeout(ms);
    await hooks((h) => h.gesture.toggle());
    for (let i = 0; i < 50 && (await hooks((h) => h.store.list().length)) === before; i++) {
      await dashboard.waitForTimeout(100);
    }
  };

  const close = () => app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  return { app, dashboard, userData, hooks, record, close };
}
