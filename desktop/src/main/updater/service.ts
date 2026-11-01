import log from 'electron-log/main';
import type { UpdateStatus } from '../../shared/channels';

// Where the installed app looks for new versions: RELEASES and the .nupkg it names, put there by
// scripts/publish-update.mjs. Built into every version, so this address has to keep working.
export const UPDATE_FEED_URL = 'https://updates.voicenote.cloud/win32/x64';
// Squirrel holds a lock during the first run after an install, so the first check waits.
const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 60 * 60_000;

/** Electron's autoUpdater, reduced to what's used here. */
export type UpdaterPort = {
  setFeedURL(url: string): void;
  check(): void;
  /** Quits and starts the new version. */
  install(): void;
  listen(on: UpdaterEvents): void;
};

export type UpdaterEvents = {
  checking(): void;
  available(): void;
  notAvailable(): void;
  downloaded(version: string | null): void;
  error(err: Error): void;
};

export type RestartResult = 'restarting' | 'busy' | 'not-ready';

type Deps = {
  port: UpdaterPort;
  version: string;
  /** Only an installed copy can update itself; dev runs and the portable zip can't. */
  supported: boolean;
  /** A recording or dictation is under way. */
  busy(): boolean;
  onChange(status: UpdateStatus): void;
  /** An update finished downloading (once per run). */
  onReady(status: UpdateStatus): void;
};

/** Checks at start and every hour, downloads in the background, and restarts only when asked. */
export class UpdateService {
  private current: UpdateStatus;
  private first: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  // A background check that fails says nothing; one the user asked for says why.
  private manual = false;

  constructor(private readonly d: Deps) {
    this.current = { version: d.version, state: d.supported ? 'idle' : 'unsupported' };
    if (!d.supported) return;
    d.port.setFeedURL(UPDATE_FEED_URL);
    d.port.listen({
      checking: () => this.set({ state: 'checking' }),
      available: () => this.set({ state: 'downloading' }),
      notAvailable: () => this.set({ state: this.manual ? 'up-to-date' : 'idle' }),
      downloaded: (version) => {
        this.set({ state: 'ready', newVersion: version });
        d.onReady(this.current);
      },
      error: (err) => {
        log.warn('[updates] check failed', err);
        this.set(this.manual ? { state: 'error', error: 'Could not check for updates. Try again later.' } : { state: 'idle' });
      },
    });
  }

  get status(): UpdateStatus {
    return this.current;
  }

  start(): void {
    if (this.current.state === 'unsupported') return;
    this.first = setTimeout(() => this.check(false), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(false), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  check(manual = true): void {
    const { state } = this.current;
    // One at a time, and a downloaded update needs nothing more.
    if (state === 'unsupported' || state === 'checking' || state === 'downloading' || state === 'ready') return;
    this.manual = manual;
    try {
      this.d.port.check();
    } catch (err) {
      log.warn('[updates] check failed', err);
      if (manual) this.set({ state: 'error', error: 'Could not check for updates. Try again later.' });
    }
  }

  restart(): RestartResult {
    if (this.current.state !== 'ready') return 'not-ready';
    if (this.d.busy()) return 'busy';
    this.d.port.install();
    return 'restarting';
  }

  private set(next: Omit<UpdateStatus, 'version'>): void {
    this.current = { version: this.d.version, ...next };
    this.d.onChange(this.current);
  }
}
