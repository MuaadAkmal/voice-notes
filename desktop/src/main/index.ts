import { app, autoUpdater, type BrowserWindow, desktopCapturer, nativeTheme, net, Notification, powerMonitor, screen, session, shell } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { type AccountInfo, type AudioDevice, Ch, type Note, type NoteContext, type OverlayState, type Settings } from '../shared/ipc';
import { acceptsDrops } from '../shared/later';
import { keepExisting } from '../shared/home-widgets';
import { showFromTitle } from '../shared/show';
import { DICTATION_TTL_MS } from '../shared/dictation';
import { cleanTranscript } from '../shared/transcription';
import { OFF as POMODORO_OFF, type Pomodoro } from '../shared/pomodoro';
import { DictationController } from './dictation/controller';
import { electronClipboard } from './dictation/clipboard';
import { pasteText } from './dictation/paste';
import { DragWatch, dropZone } from './drop/drag-watch';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { LocalWhisper } from './local-whisper';
import { registerDashboardIpc, registerOverlayIpc } from './ipc';
import { ensureLaterPage, guardWidgets, saveCapture, saveDrop } from './later';
import { OverlayMouse } from './overlay-mouse';
import { AutoPause } from './media/auto-pause';
import { registerImageProtocol, registerNoteProtocol, registerNoteScheme } from './protocol';
import { RecorderController } from './recorder/controller';
import { loadSettings, normaliseLocal, REWIND_HOTKEY, saveSettings, type SettingsFiles } from './settings';
import { applyRemotePrefs, recordPrefs } from './sync/prefs';
import { SyncController } from './sync/controller';
import { SyncPings, supabasePings } from './sync/pings';
import { SyncEngine } from './sync/engine';
import { FileSync, SyncOff } from './sync/files';
import { HttpSyncServer } from './sync/http-server';
import { ConnectorsClient } from './connectors/client';
import type { Capture } from './commands/capture';
import { CommandsClient } from './commands/client';
import { ListCommands } from './commands/service';
import { describeCapture } from './commands/describe';
import { readBrowserUrl } from './commands/browser-url';
import { readFilePath } from './commands/file-path';
import { windowScreenshot } from './commands/screenshot';
import { ensureNotesPage } from './commands/notes-page';
import { GoogleCalendar } from './connectors/google-calendar';
import { ConnectorsService } from './connectors/service';
import type { PullRequest, PushRequest } from '../shared/sync/protocol';
import { foregroundWindow, modifiersHeld, pressPlayPause, sendCtrlV, windowRect } from './win32';
import { polishDictation } from './dictation/polish';
import { cleanupOn } from '../shared/transcription';
import { MonitorFollower } from './overlay-position';
import { loginItem, updateExePath } from './updater/install';
import { type UpdaterEvents, UpdateService, type UpdaterPort } from './updater/service';
import { NoteStore } from './store/note-store';
import { CloudAsrClient } from './transcription/cloud-client';
import { resolveEndpoint } from './transcription/endpoint';
import { matchFolderCommand, PEEK_SECONDS } from '../shared/folder-command';
import { transcribe } from './transcription/openai-client';
import { safeStorageCipher, Secrets } from './transcription/secrets';
import { TranscriptionService } from './transcription/service';
import { WavBridge } from './transcription/wav-bridge';
import { createTray } from './tray';
import { AccountService } from './account/account';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './account/config';
import { SessionStore } from './account/session-store';
import { pendingBeforeSignOut } from './profiles/sign-out';
import { chooseStart } from './profiles/choose';
import { migrateToProfiles, needsMigration } from './profiles/migrate';
import { relaunch, relaunches } from './profiles/relaunch';
import { sessionUserId } from './profiles/session-user';
import { startSignIn } from './signin-mode';
import { applyCloudDefault } from './transcription/cloud-default';
import { addErrorText, formatAdded } from '../shared/calendar-format';
import { REMINDER_EVENT_MS, RemindersService } from './reminders/service';
import { ReminderScheduler } from './reminders/scheduler';
import { fired as firedReminders, showReminder } from './reminders/notify';
import {
  applyTitleBarTheme,
  createDashboardWindow,
  createOverlayWindow,
  displayOfRect,
  pillPositionOf,
  positionOverlay,
} from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

if (process.env.VOICE_NOTES_USER_DATA) app.setPath('userData', process.env.VOICE_NOTES_USER_DATA);
log.initialize();
registerNoteScheme();

const HIDDEN_ARG = '--hidden'; // passed by the login item so startup stays silent
// No answer counts as "nothing playing". The probe waits for the note's mic to open, then samples ~300 ms.
const PROBE_TIMEOUT_MS = 2000;
const DICTATION_PRUNE_MS = 60 * 60_000;
let isQuitting = false;
// Any quit (tray, update, a relaunch into another profile) lets the dashboard close instead of hiding, in both modes.
app.on('before-quit', () => (isQuitting = true));
let dashboard: BrowserWindow | null = null;
let onDashboardFocus: () => void = () => undefined; // set in boot

function showDashboard(): void {
  showDashboardThen();
}

// Kept referenced: a garbage-collected Notification loses its click handler.
let updateToast: Notification | null = null;

function electronUpdater(beforeInstall: () => void): UpdaterPort {
  return {
    setFeedURL: (url) => autoUpdater.setFeedURL({ url }),
    check: () => autoUpdater.checkForUpdates(),
    install: () => {
      beforeInstall(); // the dashboard's close only hides it otherwise, which would stop the quit
      autoUpdater.quitAndInstall();
    },
    listen: (on) => {
      autoUpdater.on('checking-for-update', on.checking);
      autoUpdater.on('update-available', on.available);
      autoUpdater.on('update-not-available', on.notAvailable);
      autoUpdater.on('error', on.error);
      autoUpdater.on('update-downloaded', (_e, _notes, name) => on.downloaded(name || null));
    },
  };
}

/** Under VOICE_NOTES_TEST=1: Playwright plays Squirrel's part, and nothing really installs. */
function fakeUpdater() {
  let events: UpdaterEvents | null = null;
  let installs = 0;
  const port: UpdaterPort = {
    setFeedURL: () => undefined,
    check: () => undefined,
    install: () => void installs++,
    listen: (on) => void (events = on),
  };
  return { port, downloaded: (version: string) => events?.downloaded(version), installs: () => installs };
}

/** Shows the dashboard; `then` runs once it can take messages (at once, or after a new window loads). */
function showDashboardThen(then?: () => void): void {
  const fresh = !dashboard || dashboard.isDestroyed();
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboardWindow();
    dashboard.on('focus', () => onDashboardFocus());
    dashboard.on('close', (e) => {
      if (isQuitting) return;
      e.preventDefault();
      dashboard?.hide();
    });
  }
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show();
  dashboard.focus();
  if (!then) return;
  if (fresh) dashboard.webContents.once('did-finish-load', then);
  else then();
}

/** Under test the browser is never opened: URLs are recorded here instead (the dashboard's links and sign-in). */
const openedExternal: string[] = [];
const testing = process.env.VOICE_NOTES_TEST === '1';

type Auth = ReturnType<typeof makeAuth>;

/** Google sign-in through Supabase; the session stays in main (root session.json, shared by every profile). */
function makeAuth(root: string) {
  const sessionStore = new SessionStore(path.join(root, 'session.json'), safeStorageCipher);
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: 'pkce',
      storage: sessionStore,
      persistSession: true,
      autoRefreshToken: !testing, // tests never talk to Supabase
      detectSessionInUrl: false,
    },
    // Electron's network stack, so the system proxy applies (as for the built-in model downloads).
    global: { fetch: (input, init) => net.fetch(input instanceof URL ? input.href : (input as string | Request), init) },
  });
  return { sessionStore, supabase };
}

/** The window only ever sees AccountInfo, never tokens. */
function makeAccount({ sessionStore, supabase }: Auth, onChange: (info: AccountInfo) => void): AccountService {
  return new AccountService({
    auth: supabase.auth,
    store: sessionStore,
    openExternal: async (url) => {
      if (testing) openedExternal.push(url);
      else await shell.openExternal(url);
    },
    fetchImage: fetchAvatar,
    focusApp: showDashboard,
    onChange,
  });
}

/**
 * Signed out: the sign-in screen only. Signed in: that account's profile (profiles/<user id>/), after moving a
 * library from before profiles into it. Reads the stored session without the network, so a PC that starts
 * offline with an expired token still opens its profile.
 */
async function start(): Promise<void> {
  const root = app.getPath('userData');
  const auth = makeAuth(root);
  const user = testing ? process.env.VOICE_NOTES_TEST_SESSION || null : sessionUserId(auth.sessionStore, SUPABASE_URL);
  if (needsMigration(root)) log.info('[profiles] migrated into', migrateToProfiles(root, user));
  const choice = chooseStart(root, user);
  if (choice.mode === 'profile') return boot(root, choice, auth);

  const account = makeAccount(auth, (info) => {
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.AccountChanged, info);
    if (info.state === 'signed-in') relaunch(info.userId);
  });
  startSignIn({
    account,
    getDashboard: () => dashboard,
    showDashboard,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });
  if (testing) (globalThis as Record<string, unknown>).__voiceNotes = { account, relaunches, openedExternal };
  else account.init().catch((err) => log.warn('[account] init failed', err));
}

async function boot(root: string, profile: { userId: string; dir: string }, auth: Auth): Promise<void> {
  const userData = profile.dir; // this account's notes, pages, recordings and images
  const settingsFiles: SettingsFiles = { pc: path.join(root, 'pc.json'), profile: path.join(userData, 'profile.json') };
  const settings: Settings = loadSettings(settingsFiles);
  // Film mode never survives a restart: the app must not start listening to system audio on its own.
  if (settings.filmMode) Object.assign(settings, saveSettings(settingsFiles, { filmMode: false }));
  // themeSource drives prefers-color-scheme in every renderer; the dashboard maps that to html.dark.
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on('updated', () => applyTitleBarTheme(dashboard));
  const store = NoteStore.open(userData);
  log.info('[store] reconcile', await store.reconcile());
  log.info('[store] purged tombstones', store.purgeTombstones(Date.now()));
  // Widgets whose page no longer exists (deleted while pruning failed, or removed outside the app).
  const liveWidgets = keepExisting(
    settings.homeWidgets,
    store.pages.list().map((p) => p.id),
  );
  if (liveWidgets.length !== settings.homeWidgets.length)
    Object.assign(settings, saveSettings(settingsFiles, { homeWidgets: liveWidgets }));
  // The built-in Review later page and its locked Home card always exist.
  const laterPatch = ensureLaterPage(settings, store.pages, randomUUID);
  if (laterPatch) Object.assign(settings, saveSettings(settingsFiles, laterPatch));
  // And the built-in Quick notes page, where a "Note, …" that matches no page lands.
  const notesPatch = ensureNotesPage(settings, store.pages);
  if (notesPatch) {
    Object.assign(settings, saveSettings(settingsFiles, notesPatch));
    recordPrefs(notesPatch, store.sync.outbox); // nothing is recorded while sync is off
  }
  store.dictations.pruneOlderThan(DICTATION_TTL_MS);
  store.reminders.prune(Date.now());
  // Audio and images from the account come through FileSync, made with the sync wiring below.
  const filesHolder: { files?: FileSync } = {};
  const fetcher = {
    fetchAudio: (id: string) => (filesHolder.files ? filesHolder.files.fetchAudio(id) : Promise.reject(new SyncOff())),
    fetchImage: (name: string) => (filesHolder.files ? filesHolder.files.fetchImage(name) : Promise.reject(new SyncOff())),
  };
  registerNoteProtocol(store, fetcher);
  registerImageProtocol(store, fetcher);

  // The display the pill is on while it follows focus; undefined until it has moved (or when off).
  let pillDisplay: number | undefined;
  const overlay = createOverlayWindow(() => settings.pillPosition, () => pillDisplay);
  // Only the overlay records; the dashboard just plays files through note://.
  const CAPTURE_PERMISSIONS = new Set(['media', 'display-capture']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(CAPTURE_PERMISSIONS.has(permission) && wc === overlay.webContents),
  );
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission) => CAPTURE_PERMISSIONS.has(permission) && wc === overlay.webContents,
  );
  // System audio: answer the overlay's getDisplayMedia with Windows loopback ('what you hear').
  // The screen source is required by the API; the overlay drops the video track immediately.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== overlay.webContents.mainFrame) {
      log.warn('[capture] display media refused for', request.frame?.url);
      callback({});
      return;
    }
    desktopCapturer
      // No thumbnails: they're unused and generating them delays the start of every system clip.
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : {}))
      .catch((err) => {
        log.error('[capture] getSources failed', err);
        callback({});
      });
  });

  const send = (channel: string, payload?: unknown) => {
    if (!overlay.isDestroyed()) overlay.webContents.send(channel, payload);
  };
  const toDashboard = (channel: string) => {
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(channel);
  };

  // Built-in transcription: engine and models are downloaded on demand into whisper/.
  const localWhisper: LocalWhisper = new LocalWhisper({
    root: path.join(root, 'whisper'), // models are shared by every profile
    arch: process.arch,
    cores: os.cpus().length,
    totalMem: os.totalmem(),
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : (input as string), init),
    onChange: () => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.LocalChanged, localWhisper.status());
    },
    log: (...a) => log.info(...a),
  });
  localWhisper.boot();
  const checked = normaliseLocal(settings, (id) => localWhisper.status().models[id]);
  if (checked !== settings) Object.assign(settings, saveSettings(settingsFiles, { transcription: checked.transcription }));
  // Cloud transcription through the `asr` Edge Function, with the app's own sign-in.
  // `supabase` is read lazily: it is set up further down, before any transcription can run.
  let testAsrToken: (() => Promise<string | null>) | null = null;
  const makeCloudAsr = (baseUrl: string) =>
    new CloudAsrClient({
      baseUrl,
      apiKey: SUPABASE_PUBLISHABLE_KEY,
      token: async () => (testAsrToken ? testAsrToken() : ((await supabase.auth.getSession()).data.session?.access_token ?? null)),
      refresh: async () => {
        await supabase.auth.refreshSession();
      },
      fetch: (input, init) => net.fetch(input instanceof URL ? input.href : (input as string), init),
    });
  let cloudClient = makeCloudAsr(`${SUPABASE_URL}/functions/v1/asr`);
  // Through the current client, so a test's useServer() applies to jobs already wired.
  const cloudAsr: Pick<CloudAsrClient, 'transcribe' | 'usage'> = {
    transcribe: (audio, language, signal, clean) => cloudClient.transcribe(audio, language, signal, clean),
    usage: () => cloudClient.usage(),
  };
  const endpoint = () => resolveEndpoint({ settings: () => settings, secrets, local: localWhisper });
  setInterval(() => {
    if (store.dictations.pruneOlderThan(DICTATION_TTL_MS) > 0) toDashboard(Ch.DictationsChanged);
  }, DICTATION_PRUNE_MS);
  const idleState = (): OverlayState =>
    settings.filmMode ? { kind: 'idle', visible: settings.showIdlePill, film: true } : { kind: 'idle', visible: settings.showIdlePill };
  // The last state sent to the pill: drops are only taken while it is visibly idle or showing "Saved".
  let overlayState = idleState();
  const setOverlayState = (s: OverlayState) => {
    overlayState = s;
    send(Ch.OverlayState, s);
  };
  const overlayMouse = new OverlayMouse((ignore) => {
    if (!overlay.isDestroyed()) overlay.setIgnoreMouseEvents(ignore, { forward: true });
  });

  // Which window the note was recorded over. Replaceable under test (there's no real foreground window).
  let foreground = foregroundWindow;
  const foregroundDisplay = (): number | null => {
    const rect = windowRect(foreground()?.hwnd ?? 0);
    return rect && displayOfRect(rect);
  };
  // The pill goes to the monitor in use, except mid-recording or under the user's hand.
  const follower = new MonitorFollower();
  const pillBusy = () =>
    controller.state !== 'idle' || dictation.active || overlayMouse.engaged || overlay.isFocusable();
  const followFocus = () => {
    if (!settings.pillFollowsFocus || overlay.isDestroyed()) return;
    const display = foregroundDisplay();
    if (display === null) return;
    const target = follower.tick(display, pillBusy());
    if (target === null) return;
    pillDisplay = target;
    positionOverlay(overlay, settings.pillPosition, target);
  };
  const captureWindow = (): Capture | null => {
    const fg = foreground();
    // No window, or our own dashboard in front: nothing to attribute the note to.
    if (!fg || !fg.title || fg.pid === process.pid) return null;
    return { hwnd: fg.hwnd ?? 0, title: fg.title, processName: fg.processName, pid: fg.pid };
  };
  // What a captured window shows, for "add this to …" and the pill's Save this.
  const describeWindow = (c: Capture) =>
    describeCapture(
      c,
      { browserUrl: (c) => readBrowserUrl(c), filePath: (c) => readFilePath(c), screenshot: (h) => windowScreenshot(h, (o) => desktopCapturer.getSources(o)) },
      (line) => log.info(line),
    );
  const getContext = (): NoteContext | null => {
    const fg = captureWindow();
    return fg && { windowTitle: fg.title.slice(0, 500), show: showFromTitle(fg.title, fg.processName) };
  };

  // Auto-pause asks the overlay whether anything is playing before pressing play/pause.
  let probeSeq = 0;
  const probes = new Map<number, (playing: boolean) => void>();
  const probePlayback = () =>
    new Promise<boolean>((resolve) => {
      const id = ++probeSeq;
      const done = (playing: boolean) => {
        clearTimeout(timer);
        probes.delete(id);
        resolve(playing);
      };
      const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
      probes.set(id, done);
      send(Ch.MediaProbe, { id });
    });
  let mediaPresses = 0;
  const autoPause = new AutoPause({
    enabled: () => settings.autoPause,
    probe: probePlayback,
    press: () => {
      mediaPresses++;
      // Under test, only count: a real key press would play/pause the developer's own music.
      if (process.env.VOICE_NOTES_TEST !== '1') pressPlayPause();
    },
  });

  const gesture = new HotkeyGesture();
  const controller = new RecorderController(
    {
      start: (deviceId, source) => send(Ch.RecorderStart, { deviceId, source, ping: settings.dictationSound }),
      stop: () => send(Ch.RecorderStop),
      cancel: () => send(Ch.RecorderCancel),
      rewind: (seconds) => send(Ch.FilmSave, { seconds }),
      setState: setOverlayState,
    },
    store,
    {
      getDeviceId: () => settings.micDeviceId,
      getSource: () => settings.recordingSource,
      getContext: () => getContext(),
      getRewindSeconds: () => settings.rewindSeconds,
      onCaptureStart: (source) => autoPause.start(source),
      onCaptureEnd: () => autoPause.end(),
      blocked: (): boolean => dictation.active,
      idleState,
      // Keep the gesture in step when recording ends without a key (auto-stop, mic error, watchdog).
      onIdle: () => gesture.reset(),
      onTitleAbandoned: () => releaseOverlayFocus(),
      onSaved: (note) => {
        log.info('[recorder] saved', note.id, note.durationMs, 'ms');
        toDashboard(Ch.NotesChanged);
        void fileByVoice(note);
      },
    },
  );
  // The pill takes keyboard focus only while a title is being typed; give it back afterwards.
  const releaseOverlayFocus = () => {
    if (overlay.isDestroyed() || !overlay.isFocusable()) return;
    overlay.setFocusable(false);
    overlay.blur();
  };
  gesture.onEvent((e) => {
    if (e === 'start' && !dictation.active) {
      releaseOverlayFocus(); // a new recording abandons an open title input
      dictation.dismissFlash();
    }
    controller.handleGesture(e);
  });

  // Dictation: Ctrl+Win, transcript pasted into the focused app. Under test, texts are only recorded.
  const pasted: string[] = [];
  const dictationGesture = new HotkeyGesture();
  const dictation = new DictationController({
    overlay: {
      start: (deviceId, ping) => send(Ch.RecorderStart, { deviceId, source: 'mic', dictation: { ping } }),
      stop: () => send(Ch.RecorderStop),
      cancel: () => send(Ch.RecorderCancel),
      setState: setOverlayState,
    },
    configured: () => settings.transcription.provider !== null,
    blocked: (): boolean => controller.state !== 'idle',
    getDeviceId: () => settings.micDeviceId,
    sound: () => settings.dictationSound,
    getApp: () => getContext()?.show ?? null,
    getCapture: captureWindow,
    transcribe: async (audio, signal) => {
      const { transcription, transcribeLanguage } = settings;
      const ep = await endpoint();
      try {
        const language = transcribeLanguage === 'auto' ? null : transcribeLanguage;
        if (ep.cloud) {
          const t0 = Date.now();
          const r = await cloudAsr.transcribe(audio, language, signal, cleanupOn(settings));
          log.info('[dictation] ms', JSON.stringify({ transcribe: Date.now() - t0, server: r.ms, bytes: audio.length }));
          return cleanTranscript(r.text);
        }
        const result = await transcribe({
          baseUrl: ep.baseUrl,
          model: ep.model,
          apiKey: ep.apiKey,
          language: transcribeLanguage === 'auto' ? null : transcribeLanguage,
          audio,
          filename: 'dictation.wav',
          // The built-in engine may still be loading its model on a slow CPU.
          timeoutMs: transcription.provider === 'local' ? 120_000 : 30_000,
          signal,
        });
        return cleanTranscript(result.text);
      } finally {
        ep.release();
      }
    },
    polish: async (text, signal) => {
      const t0 = Date.now();
      const out = await polishDictation(text, signal, {
        enabled: () => cleanupOn(settings),
        polish: (t, o) => commandsClient.polish(t, o),
      });
      log.info('[dictation] ms', JSON.stringify({ polish: Date.now() - t0, changed: out !== text, chars: text.length }));
      return out;
    },
    prewarm: () => {
      const { provider, localModel } = settings.transcription;
      if (provider === 'local' && localModel) localWhisper.prewarm(localModel);
    },
    save: (text, app) => {
      store.dictations.add(text, app);
      toDashboard(Ch.DictationsChanged);
    },
    paste: async (text) => {
      if (process.env.VOICE_NOTES_TEST === '1') {
        pasted.push(text);
        return;
      }
      await pasteText(text, {
        clipboard: electronClipboard,
        modifiersHeld,
        sendCtrlV,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }).catch((err) => log.error('[dictation] paste failed', err));
    },
    idleState,
    calendar: {
      // needs-reconnect too, so the pill says why instead of pasting "Calendar, …" silently.
      enabled: () => settings.voiceToCalendar && ['connected', 'needs-reconnect'].includes(connectors.current().state),
      add: async (text) => {
        const r = await connectors.quickAdd(text);
        return 'event' in r ? { ok: true, message: `Added · ${formatAdded(r.event)}` } : { ok: false, message: addErrorText(r.error) };
      },
    },
    reminder: {
      enabled: () => settings.voiceReminders,
      add: async (text) => (await reminders.add(text)) ?? { ok: false, message: "Couldn't set the reminder" },
    },
    list: {
      enabled: () => settings.voiceToLists, // signed out, it still lands in Quick notes
      wakeWords: () => settings.noteWakeWords,
      add: (text, capture) => listCommands.add(text, capture),
    },
    onIdle: () => dictationGesture.reset(),
    onCaptureStart: () => autoPause.start('mic'),
    onCaptureEnd: () => autoPause.end(),
  });
  dictationGesture.onEvent((e) => {
    if (e === 'start' && controller.state === 'idle') {
      releaseOverlayFocus(); // a dictation abandons an open title input, like a new recording
      controller.dismissFlash();
    }
    dictation.handleGesture(e);
  });
  overlay.webContents.on('did-finish-load', () => {
    setOverlayState(idleState());
    send(Ch.FilmMode, { on: settings.filmMode }); // a reloaded overlay restarts the buffer
    send(Ch.PomodoroConfig, settings.pomodoro);
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    log.error('[overlay] renderer gone', details.reason);
    if (!overlay.isDestroyed()) overlay.webContents.reload();
  });

  let devices: AudioDevice[] = [];
  // The overlay's pomodoro, as it last reported it (the dashboard's Pomodoro page shows it).
  let pomodoro: Pomodoro = POMODORO_OFF;
  registerOverlayIpc({
    overlay,
    overlayMouse,
    gesture,
    controller,
    dictation,
    dictationGesture,
    onDevices: (d) => (devices = d),
    onDragEnd: () => {
      const pillPosition = pillPositionOf(overlay);
      if (settings.pillFollowsFocus) {
        pillDisplay = pillPosition.displayId;
        follower.settle(foregroundDisplay());
      }
      updateSettings({ pillPosition });
    },
    titles: {
      start: () => {
        // Only take keyboard focus if the "Saved" pill is really on screen to type into.
        if (!controller.holdFlash()) return;
        overlay.setFocusable(true);
        overlay.focus();
      },
      submit: (noteId, title) => {
        releaseOverlayFocus();
        if (noteId !== controller.lastSavedId) {
          log.warn('[overlay] title for a note other than the one just saved; ignored');
          controller.titleCancelled();
          return;
        }
        try {
          store.rename(noteId, title);
          toDashboard(Ch.NotesChanged);
          controller.titleDone();
        } catch (err) {
          log.error('[overlay] rename failed', err);
          controller.titleCancelled();
        }
      },
      cancel: () => {
        releaseOverlayFocus();
        controller.titleCancelled();
      },
    },
    onFilmError: (message) => {
      log.warn('[film] buffer stopped:', message);
      if (settings.filmMode) updateSettings({ filmMode: false });
      controller.notify(message);
    },
    onProbeResult: (id, playing) => probes.get(id)?.(playing),
    onDrop: (payload) => {
      try {
        const result = saveDrop(payload, {
          pages: store.pages,
          getSettings: () => settings,
          updateSettings,
          source: () => getContext()?.show ?? null, // the browser the drag came from
          window: captureWindow,
          newId: randomUUID,
        });
        if (result.kind === 'saved') toDashboard(Ch.PagesChanged);
        return result;
      } catch (err) {
        log.error('[later] drop not saved', err);
        throw err;
      }
    },
    onCaptureLater: async () => {
      try {
        const result = await saveCapture({
          pages: store.pages,
          getSettings: () => settings,
          updateSettings,
          capture: captureWindow,
          describe: describeWindow,
          saveImage: (bytes) => store.pages.saveImage(bytes, 'jpg'),
          newId: randomUUID,
        });
        if (result.kind === 'saved') toDashboard(Ch.PagesChanged);
        return result;
      } catch (err) {
        log.error('[later] capture not saved', err);
        throw err;
      }
    },
    onPomodoro: (timer) => {
      pomodoro = timer;
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.PomodoroChanged, timer);
    },
    onPomodoroDone: (focusMs) => {
      store.pomodoro.add(focusMs);
      toDashboard(Ch.PomodoroSessionsChanged);
    },
  });

  const rewind = () => {
    if (!settings.filmMode) {
      controller.notify('Turn on film mode to rewind');
      return;
    }
    releaseOverlayFocus(); // a rewind replaces an open title input, like a new recording
    controller.rewind();
  };

  const hotkey = new HotkeyService(gesture);
  hotkey.setCombo(settings.hotkey);
  hotkey.setRewindCombo(REWIND_HOTKEY);
  hotkey.attachDictation(dictationGesture);
  // The gesture is already idle while a dictation transcribes; Esc must still cancel it.
  hotkey.onEscape(() => dictation.handleGesture('cancel'));
  hotkey.setDictationCombo(settings.dictationHotkey);
  hotkey.onRewind(rewind);
  hotkey.setPaused(settings.hotkeyPaused);
  const dragWatch = new DragWatch({
    accepting: () => acceptsDrops(overlayState),
    bounds: () => dropZone(overlay.getBounds()),
    toDip: (p) => screen.screenToDipPoint(p),
    setDrag: (on) => overlayMouse.setDrag(on),
    later: (fn, ms) => setTimeout(fn, ms),
  });
  hotkey.onMouse((e) => dragWatch.onInput(e));
  // Under test the gesture is driven through __voiceNotes; a global hook would also react to whatever
  // the person at the keyboard is doing and scramble the run.
  if (process.env.VOICE_NOTES_TEST !== '1') hotkey.start();
  // Only an installed copy has Squirrel's Update.exe; dev runs and the portable zip don't.
  const installed = app.isPackaged && fs.existsSync(updateExePath(process.execPath));
  const applyLoginItem = (openAtLogin: boolean) =>
    app.setLoginItemSettings({ openAtLogin, ...loginItem(process.execPath, installed, HIDDEN_ARG) });
  const testUpdates = fakeUpdater();
  const fakeUpdates = process.env.VOICE_NOTES_TEST === '1';
  const updates = new UpdateService({
    port: fakeUpdates ? testUpdates.port : electronUpdater(() => (isQuitting = true)),
    version: app.getVersion(),
    supported: installed || fakeUpdates,
    busy: () => controller.state !== 'idle' || dictation.active,
    onChange: (status) => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.UpdatesChanged, status);
    },
    onReady: (status) => {
      if (fakeUpdates || !Notification.isSupported()) return;
      updateToast = new Notification({
        title: status.newVersion ? `Version ${status.newVersion} is ready` : 'A new version is ready',
        body: 'Open Voice Notes to restart and update.',
      });
      updateToast.on('click', showDashboard);
      updateToast.show();
    },
  });
  // Not under test: the pill's place must not depend on what's in front on the machine running the tests.
  const followTimer = process.env.VOICE_NOTES_TEST === '1' ? null : setInterval(followFocus, 300);

  const tray = createTray({
    openDashboard: showDashboard,
    isPaused: () => settings.hotkeyPaused,
    getSource: () => settings.recordingSource,
    setSource: (recordingSource) => updateSettings({ recordingSource }),
    resetPill: () => updateSettings({ pillPosition: null }),
    isFilmMode: () => settings.filmMode,
    toggleFilmMode: () => updateSettings({ filmMode: !settings.filmMode }),
    togglePause: () => updateSettings({ hotkeyPaused: !settings.hotkeyPaused }).hotkeyPaused,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  /** record: false for settings that just arrived from the account (they must not be sent back). */
  function updateSettings(patch: Partial<Settings>, opts: { record?: boolean } = {}): Settings {
    // A widget list from the dashboard (possibly stale) never loses the locked Review later card.
    patch = guardWidgets(patch, settings, randomUUID);
    Object.assign(settings, saveSettings(settingsFiles, patch));
    if (opts.record !== false) recordPrefs(patch, store.sync.outbox);
    if (patch.hotkey) hotkey.setCombo(settings.hotkey);
    if (patch.dictationHotkey) hotkey.setDictationCombo(settings.dictationHotkey);
    if (patch.recordingSource) tray.refresh();
    // Reset (null) or a move from elsewhere: put the window where the setting says.
    if (patch.pillFollowsFocus !== undefined) {
      pillDisplay = undefined;
      follower.settle(null); // on: the next tick brings the pill to the window in front
    }
    if ('pillPosition' in patch || patch.pillFollowsFocus !== undefined) {
      positionOverlay(overlay, settings.pillPosition, pillDisplay);
    }
    if (patch.hotkeyPaused !== undefined) {
      hotkey.setPaused(settings.hotkeyPaused);
      tray.refresh();
    }
    if (patch.launchAtLogin !== undefined) {
      applyLoginItem(settings.launchAtLogin);
    }
    if (patch.filmMode !== undefined) {
      send(Ch.FilmMode, { on: settings.filmMode });
      tray.refresh();
    }
    // Not over a saved flash: that would wipe "Add title" (or a title being typed).
    if (patch.showIdlePill !== undefined || patch.filmMode !== undefined) controller.refreshIdle();
    if (patch.pomodoro) send(Ch.PomodoroConfig, settings.pomodoro);
    if (patch.theme) nativeTheme.themeSource = settings.theme; // fires 'updated' → caption buttons recolour
    toDashboard(Ch.SettingsChanged);
    return { ...settings };
  }

  const secrets = new Secrets(path.join(root, 'secrets.json'), safeStorageCipher);

  const syncHolder: { controller?: SyncController } = {}; // set below; the account callback needs it
  const connectorsHolder: { service?: ConnectorsService } = {};
  const { sessionStore, supabase } = auth;
  const account = makeAccount(auth, (info) => {
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.AccountChanged, info);
    // Signed out (or the session was revoked): back to the sign-in screen. Only once the stored session is
    // really gone: init reports signed-out when an offline start can't refresh an expired token, but supabase-js
    // keeps that session, and start-up would open this profile again, round and round.
    if (info.state === 'signed-out' && (testing || !sessionUserId(sessionStore, SUPABASE_URL))) {
      relaunch(null);
      return;
    }
    // Signed in as someone else (e.g. from the Sign in a signed-out chip offers): that account's profile.
    if (info.state === 'signed-in' && info.userId !== profile.userId) {
      relaunch(info.userId);
      return;
    }
    syncHolder.controller?.onAccountChanged();
    connectorsHolder.service?.onAccountChanged();
    // Boot (session restored) and every sign-in: Cloud becomes the provider if none is set up.
    const patch = bootTestSession ? null : applyCloudDefault(settings, info.state === 'signed-in');
    if (patch) updateSettings(patch, { record: false });
  });
  // e2e: launched signed in as the profile's account, with the provider left unset as the specs expect; a spec's
  // own setTestSession then applies the Cloud default like a real sign-in.
  let bootTestSession = testing;
  if (testing) account.setTestSession({ state: 'signed-in', userId: profile.userId, email: 'test@example.com', name: 'Test User', avatar: null });
  else account.init().catch((err) => log.warn('[account] init failed', err));
  bootTestSession = false;

  // Two-PC sync through the `sync` Edge Function: rows, then audio and images.
  let testToken: (() => Promise<string | null>) | null = null;
  const makeSyncServer = (baseUrl: string) =>
    new HttpSyncServer({
      baseUrl,
      apiKey: SUPABASE_PUBLISHABLE_KEY,
      // A token only for the account this PC syncs with: never another account's, even mid-switch.
      getToken: async () => {
        if (testToken) return testToken();
        const session = (await supabase.auth.getSession()).data.session;
        return session && session.user.id === store.sync.state.accountId() ? session.access_token : null;
      },
      fetch: (input, init) => net.fetch(input instanceof URL ? input.href : (input as string), init),
    });
  let syncServer = makeSyncServer(SUPABASE_URL);
  const syncEngine = new SyncEngine(
    store,
    { push: (req: PushRequest) => syncServer.push(req), pull: (req: PullRequest) => syncServer.pull(req) },
    {
      get: () => settings,
      update: (patch, opts) => updateSettings(patch, opts),
      applyRemote: (prefs) =>
        applyRemotePrefs(prefs, {
          getSettings: () => settings,
          updateSettings: (patch, opts) => updateSettings(patch, opts),
          pages: store.pages,
          deviceName: store.sync.state.deviceName(),
        }),
    },
  );
  syncEngine.queueExistingFiles(); // audio and images of a PC that synced rows before files did
  const fileSync = new FileSync({
    store,
    // Through the current server, so a test's useServer() applies to files too.
    server: {
      uploadUrl: (req) => syncServer.uploadUrl(req),
      downloadUrl: (req) => syncServer.downloadUrl(req),
      put: (url, bytes, type) => syncServer.put(url, bytes, type),
      get: (url) => syncServer.get(url),
    },
    canSync: () => {
      const info = account.current();
      return info.state === 'signed-in' && info.userId === store.sync.state.accountId();
    },
    onNotesChanged: () => toDashboard(Ch.NotesChanged),
  });
  filesHolder.files = fileSync;
  // Under test, pings come from __voiceNotes.sync.ping instead of Realtime.
  let testPing: ((from: string) => void) | null = null;
  const syncPings = new SyncPings({
    source: testing
      ? { listen: (_user, onPing) => ((testPing = onPing), () => void (testPing = null)) }
      : supabasePings(supabase),
    selfId: () => store.sync.state.deviceId(),
    onRemoteChange: () => syncController.onRemoteChange(),
  });
  const syncController: SyncController = new SyncController({
    pings: syncPings,
    files: fileSync,
    engine: syncEngine,
    state: store.sync.state,
    settings: () => settings,
    currentUser: () => {
      const info = account.current();
      return info.state === 'signed-in' ? info.userId : null;
    },
    refreshSession: async () => {
      if (!testToken) await supabase.auth.refreshSession();
    },
    onView: (view) => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.SyncChanged, view);
    },
    onChanged: (changes) => {
      // Settings arrive through updateSettings, which already tells both windows.
      if (changes.notes) toDashboard(Ch.NotesChanged);
      if (changes.pages) toDashboard(Ch.PagesChanged);
      if (changes.folders) toDashboard(Ch.FoldersChanged);
    },
  });
  syncHolder.controller = syncController;
  store.sync.outbox.onRecord = () => syncController.onLocalChange();
  store.sync.files.onRecord = () => syncController.onLocalChange();
  powerMonitor.on('resume', () => syncController.onResume());
  syncController.start();
  // This profile's account, always synced; a database bound to another account never is (not expected).
  if (!syncController.bind(profile.userId)) log.error('[sync] profile/account mismatch', profile.userId, store.sync.state.accountId());

  // Google Calendar through the `connectors` Edge Function: it keeps the refresh token, main gets
  // short-lived access tokens and calls Google itself.
  let testConnectorsToken: (() => Promise<string | null>) | null = null;
  const connectorsFetch: typeof fetch = (input, init) => net.fetch(input instanceof URL ? input.href : (input as string), init);
  const makeConnectors = (baseUrl: string, calendarUrl?: string) => {
    const client = new ConnectorsClient({
      baseUrl,
      apiKey: SUPABASE_PUBLISHABLE_KEY,
      getToken: async () => {
        if (testConnectorsToken) return testConnectorsToken();
        return (await supabase.auth.getSession()).data.session?.access_token ?? null;
      },
      fetch: connectorsFetch,
    });
    return { client, calendar: new GoogleCalendar({ token: () => client.token(), fetch: connectorsFetch, baseUrl: calendarUrl }) };
  };
  let connectorsApi = makeConnectors(SUPABASE_URL);
  const connectors = new ConnectorsService({
    client: {
      start: (returnPort) => connectorsApi.client.start(returnPort),
      status: () => connectorsApi.client.status(),
      attempt: (state) => connectorsApi.client.attempt(state),
      disconnect: () => connectorsApi.client.disconnect(),
    },
    calendar: {
      todayEvents: (now) => connectorsApi.calendar.todayEvents(now),
      events: (from, to) => connectorsApi.calendar.events(from, to),
      create: (e) => connectorsApi.calendar.create(e),
      quickAdd: (text) => connectorsApi.calendar.quickAdd(text),
      clear: () => connectorsApi.calendar.clear(),
    },
    userId: () => {
      const info = account.current();
      return info.state === 'signed-in' ? info.userId : null;
    },
    openExternal: async (url) => {
      if (testing) openedExternal.push(url);
      else await shell.openExternal(url);
    },
    focusApp: showDashboard,
    onChange: (info) => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.ConnectorsChanged, info);
    },
  });
  connectorsHolder.service = connectors;

  // Voice to lists through the `commands` Edge Function, which holds the Groq key.
  let testCommandsToken: (() => Promise<string | null>) | null = null;
  const makeCommandsClient = (baseUrl: string) =>
    new CommandsClient({
      baseUrl,
      apiKey: SUPABASE_PUBLISHABLE_KEY,
      getToken: async () => {
        if (testCommandsToken) return testCommandsToken();
        return (await supabase.auth.getSession()).data.session?.access_token ?? null;
      },
      fetch: connectorsFetch,
    });
  let commandsClient = makeCommandsClient(SUPABASE_URL);
  const listCommands = new ListCommands({
    resolve: (req) => commandsClient.resolve(req),
    describe: describeWindow,
    saveImage: (bytes) => store.pages.saveImage(bytes, 'jpg'),
    pages: store.pages,
    quickNotes: () => {
      const patch = ensureNotesPage(settings, store.pages);
      if (patch) updateSettings(patch);
      return settings.notesPageId!;
    },
    pagesChanged: () => toDashboard(Ch.PagesChanged),
  });
  // Under test the clock can be moved forward (__voiceNotes.reminders.setNow) to make a reminder due.
  let reminderNow = () => Date.now();
  const reminders = new RemindersService({
    store: store.reminders,
    now: () => reminderNow(),
    remind: (req) => commandsClient.remind(req),
    toQuickNotes: (text) => {
      const patch = ensureNotesPage(settings, store.pages);
      if (patch) updateSettings(patch);
      store.pages.appendLine(settings.notesPageId!, text);
      toDashboard(Ch.PagesChanged);
    },
    google: {
      connected: () => connectors.current().state === 'connected',
      create: async (text, dueAt) =>
        (await connectorsApi.calendar.create({ title: text, allDay: false, start: dueAt, end: dueAt + REMINDER_EVENT_MS }, { popupAtStart: true })).id,
      remove: (eventId) => connectorsApi.calendar.remove(eventId),
      move: (eventId, start, end) => connectorsApi.calendar.move(eventId, start, end),
    },
    changed: () => toDashboard(Ch.RemindersChanged),
    warn: (msg, err) => log.warn(msg, err),
  });
  const openReminders = () => showDashboardThen(() => toDashboard(Ch.OpenReminders));
  const reminderScheduler = new ReminderScheduler({
    store: store.reminders,
    now: () => reminderNow(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
    fire: (r, missed) => {
      showReminder(r, missed, {
        snooze: () => void reminders.snooze(r.id),
        done: () => void reminders.done(r.id),
        open: openReminders,
      });
      toDashboard(Ch.RemindersChanged); // "Due" now
    },
  });
  reminderScheduler.start();
  powerMonitor.on('resume', () => reminderScheduler.check());
  onDashboardFocus = () => connectors.onFocus();
  void connectors.refresh();
  const wavBridge = new WavBridge();
  const transcription = new TranscriptionService({
    store,
    endpoint,
    cloud: cloudAsr,
    secrets,
    toWav: (bytes, mimeType) =>
      wavBridge.request((requestId) => {
        if (!dashboard || dashboard.isDestroyed()) return false;
        dashboard.webContents.send(Ch.TranscriptionNeedWav, { requestId, bytes, mimeType });
        return true;
      }),
    notesChanged: () => toDashboard(Ch.NotesChanged),
    fetchAudio: (id) => fileSync.fetchAudio(id),
    onStatus: (status) => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.TranscriptionStatus, status);
    },
  });

  // Voice to folders: "Pixie, movie lines …" at the start of a mic note files it into that folder.
  const fileByVoice = async (note: Note) => {
    if (!settings.voiceToFolders || !settings.transcription.provider || note.kind !== 'note' || note.source !== 'mic') return;
    try {
      const head = await transcription.peek(note.id, PEEK_SECONDS);
      const folder = matchFolderCommand(head, settings.noteWakeWords, store.folders.list());
      if (!folder) return;
      store.moveNotes([note.id], folder.id);
      toDashboard(Ch.NotesChanged);
      log.info('[voice-to-folders]', note.id, '→', folder.name);
      if (overlayState.kind === 'idle' || (overlayState.kind === 'saved' && overlayState.noteId === note.id)) {
        setOverlayState({ kind: 'done', message: `Saved → ${folder.name}` });
        setTimeout(() => overlayState.kind === 'done' && setOverlayState(idleState()), 2500);
      }
    } catch (e) {
      log.warn('[voice-to-folders] skipped', note.id, e instanceof Error ? e.message : e);
    }
  };

  registerDashboardIpc({
    getDashboard: () => dashboard,
    store,
    hotkey,
    getSettings: () => ({ ...settings }),
    updateSettings,
    getDevices: () => devices,
    notesChanged: () => toDashboard(Ch.NotesChanged),
    foldersChanged: () => toDashboard(Ch.FoldersChanged),
    pagesChanged: () => toDashboard(Ch.PagesChanged),
    dictationsChanged: () => toDashboard(Ch.DictationsChanged),
    openedExternal,
    transcription,
    cloud: cloudAsr,
    secrets,
    wavBridge,
    localWhisper,
    account,
    pendingBeforeSignOut: () =>
      pendingBeforeSignOut({
        flush: () => syncController.flush(),
        pending: () => store.sync.outbox.pending().length + store.sync.files.count(),
      }),
    sync: syncController,
    connectors,
    reminders,
    files: fileSync,
    updates,
    pomodoro: {
      get: () => pomodoro,
      command: (action) => send(Ch.PomodoroCommand, { action }),
      sessions: () => store.pomodoro.list(),
      clear: () => {
        store.pomodoro.clear();
        toDashboard(Ch.PomodoroSessionsChanged);
      },
    },
  });

  app.on('before-quit', () => {
    isQuitting = true;
    autoPause.end(); // quitting mid-note must not leave the film paused
  });
  // An earlier version's login item points into its own app-x.y.z folder, which an update leaves behind.
  if (installed && settings.launchAtLogin) applyLoginItem(true);
  updates.start();
  app.on('will-quit', () => {
    updates.stop();
    if (followTimer) clearInterval(followTimer);
    syncController.stop();
    localWhisper.stop(); // never leave whisper-server.exe running
    hotkey.stop();
    store.close();
  });

  if (process.env.VOICE_NOTES_TEST === '1') {
    (globalThis as Record<string, unknown>).__voiceNotes = {
      gesture,
      controller,
      store,
      rewind, // what Alt+Win+Shift does
      setForeground: (fn: typeof foregroundWindow) => (foreground = fn),
      updates: testUpdates, // downloaded(version): as if Squirrel finished; installs(): restarts asked for
      mediaPresses: () => mediaPresses,
      openedExternal, // URLs the dashboard asked to open in the browser
      pagesChanged: () => toDashboard(Ch.PagesChanged), // after editing pages through `store` directly
      transcription, // idle(): wait for queued transcriptions
      dictationGesture, // what Ctrl+Win does
      dictation,
      pasted, // texts a dictation would have pasted
      localWhisper, // setTestOverrides({ catalog, spawn }): fake downloads and engine
      account, // setTestSession(info): signed in or out without Google
      relaunches, // where the app would have restarted into: a user id, or null for the sign-in screen
      sync: {
        useServer: (url: string) => void (syncServer = makeSyncServer(url)), // a local test server
        useToken: (fn: () => Promise<string | null>) => void (testToken = fn),
        now: () => syncController.syncNow(),
        ping: (from: string) => testPing?.(from), // as if another PC pushed
      },
      connectors: {
        // A local stand-in for the function, which also serves the Calendar API under /calendar/v3.
        useServer: (url: string) => void (connectorsApi = makeConnectors(url, `${url}/calendar/v3`)),
        // A new token: look at the connection again (at boot it was checked against the real server, as signed out).
        useToken: (fn: () => Promise<string | null>) => {
          testConnectorsToken = fn;
          void connectors.refresh();
        },
        service: connectors,
      },
      reminders: {
        fired: firedReminders,
        check: () => reminderScheduler.check(),
        service: reminders,
        setNow: (fn: () => number) => void (reminderNow = fn),
      },
      asr: {
        // A local stand-in for the `asr` function: its handler over memory, with a fake transcriber.
        useServer: (url: string) => void (cloudClient = makeCloudAsr(url)),
        useToken: (fn: () => Promise<string | null>) => void (testAsrToken = fn),
      },
      commands: {
        // A local stand-in for the function: its handler over memory, with a fake Groq.
        useServer: (url: string) => void (commandsClient = makeCommandsClient(url)),
        useToken: (fn: () => Promise<string | null>) => void (testCommandsToken = fn),
      },
    };
  }

  if (!process.argv.includes(HIDDEN_ARG)) showDashboard();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showDashboard);
  // The overlay window always exists, so this only fires during quit; never auto-quit on window close.
  app.on('window-all-closed', () => undefined);
  app.whenReady().then(start).catch((err) => {
    log.error('[boot] failed', err);
    app.quit();
  });
}

const AVATAR_MAX_BYTES = 1024 * 1024;

/** The Google photo as a data: URL (the dashboard's CSP stays closed to the web), or null. */
async function fetchAvatar(url: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)/.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > AVATAR_MAX_BYTES) return null;
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
