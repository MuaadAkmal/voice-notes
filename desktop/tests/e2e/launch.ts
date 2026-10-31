import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { Folder, Note, Reminder, Page as TextPage } from '../../src/shared/channels';

// Drives the production Vite build (`npm run package` emits .vite/) through the dev Electron binary:
// packaged builds disable the Node inspector fuse that Playwright needs.
export type Hooks = {
  gesture: { toggle(): void; escape(): void };
  store: {
    list(): Note[];
    absolutePath(n: Note): string;
    rename(id: string, title: string): Note;
    folders: { list(): Folder[] };
    pages: { list(): TextPage[]; deleteMany(ids: string[]): Promise<void> };
  };
  rewind(): void;
  setForeground(fn: () => { title: string; processName: string; pid: number } | null): void;
  mediaPresses(): number;
  pagesChanged(): void;
  openedExternal: string[];
  transcription: { idle(): Promise<void> };
  dictationGesture: { toggle(): void };
  pasted: string[];
  account: { setTestSession(info: unknown): void };
  reminders: {
    fired: { id: string; text: string; missed: boolean }[];
    check(): void;
    setNow(fn: () => number): void;
    service: { list(): Reminder[] };
  };
};

export type TestApp = {
  app: ElectronApplication;
  dashboard: Page;
  userData: string;
  hooks: <T>(fn: (h: Hooks) => T) => Promise<T>;
  record: (ms?: number) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * fakeAudioFile: the WAV Chromium's fake mic plays. The default is a steady tone: its own beeps are too sparse for a
 * short clip to count as heard. userData: reuse a data dir (relaunch).
 */
export async function launch({ fakeAudioFile = 'tests/e2e/fixtures/tone.wav', userData: reuseData }: { fakeAudioFile?: string; userData?: string } = {}): Promise<TestApp> {
  const userData = reuseData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vn-e2e-'));
  const app = await electron.launch({
    args: [
      '.',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve(fakeAudioFile)}`,
    ],
    // Playwright emulates prefers-color-scheme: light by default; let nativeTheme decide, as in the real app.
    colorScheme: null,
    env: { ...process.env, VOICE_NOTES_TEST: '1', VOICE_NOTES_USER_DATA: userData },
  });
  // The inspector can run a call in the middle of a query in main ("database connection is busy"): wait for the event loop.
  const evaluate = app.evaluate.bind(app) as (fn: unknown, arg: unknown) => Promise<unknown>;
  (app as { evaluate: unknown }).evaluate = (fn: unknown, arg?: unknown) =>
    evaluate(
      (electronModule: unknown, call: { src: string; arg: unknown }) =>
        new Promise((resolve, reject) => {
          setImmediate(() => {
            try {
              resolve(new Function('electron', 'arg', `return (${call.src})(electron, arg)`)(electronModule, call.arg));
            } catch (err) {
              reject(err);
            }
          });
        }),
      { src: String(fn), arg },
    );
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
