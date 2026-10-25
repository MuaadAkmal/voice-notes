import { app, type BrowserWindow, desktopCapturer, nativeTheme, session } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { type AudioDevice, Ch, type NoteContext, type OverlayState, type Settings } from '../shared/ipc';
import { keepExisting } from '../shared/home-widgets';
import { showFromTitle } from '../shared/show';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { registerDashboardIpc, registerOverlayIpc } from './ipc';
import { AutoPause } from './media/auto-pause';
import { registerImageProtocol, registerNoteProtocol, registerNoteScheme } from './protocol';
import { RecorderController } from './recorder/controller';
import { loadSettings, REWIND_HOTKEY, saveSettings } from './settings';
import { foregroundWindow, pressPlayPause } from './win32';
import { NoteStore } from './store/note-store';
import { createTray } from './tray';
import { applyTitleBarTheme, createDashboardWindow, createOverlayWindow, pillPositionOf, positionOverlay } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

if (process.env.VOICE_NOTES_USER_DATA) app.setPath('userData', process.env.VOICE_NOTES_USER_DATA);
log.initialize();
registerNoteScheme();

const HIDDEN_ARG = '--hidden'; // passed by the login item so startup stays silent
// No answer counts as "nothing playing". The probe waits for the note's mic to open, then samples ~300 ms.
const PROBE_TIMEOUT_MS = 2000;
let isQuitting = false;
let dashboard: BrowserWindow | null = null;

function showDashboard(): void {
  if (!dashboard || dashboard.isDestroyed()) {
    dashboard = createDashboardWindow();
    dashboard.on('close', (e) => {
      if (isQuitting) return;
      e.preventDefault();
      dashboard?.hide();
    });
  }
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show();
  dashboard.focus();
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  const settingsFile = path.join(userData, 'settings.json');
  const settings: Settings = loadSettings(settingsFile);
  // Film mode never survives a restart: the app must not start listening to system audio on its own.
  if (settings.filmMode) Object.assign(settings, saveSettings(settingsFile, { filmMode: false }));
  // themeSource drives prefers-color-scheme in every renderer; the dashboard maps that to html.dark.
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on('updated', () => applyTitleBarTheme(dashboard));
  const store = NoteStore.open(userData);
  log.info('[store] reconcile', await store.reconcile());
  // Widgets whose page no longer exists (deleted while pruning failed, or removed outside the app).
  const liveWidgets = keepExisting(
    settings.homeWidgets,
    store.pages.list().map((p) => p.id),
  );
  if (liveWidgets.length !== settings.homeWidgets.length)
    Object.assign(settings, saveSettings(settingsFile, { homeWidgets: liveWidgets }));
  registerNoteProtocol(store);
  registerImageProtocol(store);

  const overlay = createOverlayWindow(() => settings.pillPosition);
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
  const idleState = (): OverlayState =>
    settings.filmMode ? { kind: 'idle', visible: settings.showIdlePill, film: true } : { kind: 'idle', visible: settings.showIdlePill };

  // Which window the note was recorded over. Replaceable under test (there's no real foreground window).
  let foreground = foregroundWindow;
  const getContext = (): NoteContext | null => {
    const fg = foreground();
    // No window, or our own dashboard in front: nothing to attribute the note to.
    if (!fg || !fg.title || fg.pid === process.pid) return null;
    return { windowTitle: fg.title.slice(0, 500), show: showFromTitle(fg.title, fg.processName) };
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
      start: (deviceId, source) => send(Ch.RecorderStart, { deviceId, source }),
      stop: () => send(Ch.RecorderStop),
      cancel: () => send(Ch.RecorderCancel),
      rewind: (seconds) => send(Ch.FilmSave, { seconds }),
      setState: (s) => send(Ch.OverlayState, s),
    },
    store,
    {
      getDeviceId: () => settings.micDeviceId,
      getSource: () => settings.recordingSource,
      getContext: () => getContext(),
      getRewindSeconds: () => settings.rewindSeconds,
      onCaptureStart: (source) => autoPause.start(source),
      onCaptureEnd: () => autoPause.end(),
      idleState,
      // Keep the gesture in step when recording ends without a key (auto-stop, mic error, watchdog).
      onIdle: () => gesture.reset(),
      onTitleAbandoned: () => releaseOverlayFocus(),
      onSaved: (note) => {
        log.info('[recorder] saved', note.id, note.durationMs, 'ms');
        toDashboard(Ch.NotesChanged);
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
    if (e === 'start') releaseOverlayFocus(); // a new recording abandons an open title input
    controller.handleGesture(e);
  });
  overlay.webContents.on('did-finish-load', () => {
    send(Ch.OverlayState, idleState());
    send(Ch.FilmMode, { on: settings.filmMode }); // a reloaded overlay restarts the buffer
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    log.error('[overlay] renderer gone', details.reason);
    if (!overlay.isDestroyed()) overlay.webContents.reload();
  });

  let devices: AudioDevice[] = [];
  registerOverlayIpc({
    overlay,
    gesture,
    controller,
    onDevices: (d) => (devices = d),
    onDragEnd: () => updateSettings({ pillPosition: pillPositionOf(overlay) }),
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
  hotkey.onRewind(rewind);
  hotkey.setPaused(settings.hotkeyPaused);
  // Under test the gesture is driven through __voiceNotes; a global hook would also react to whatever
  // the person at the keyboard is doing and scramble the run.
  if (process.env.VOICE_NOTES_TEST !== '1') hotkey.start();

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

  function updateSettings(patch: Partial<Settings>): Settings {
    Object.assign(settings, saveSettings(settingsFile, patch));
    if (patch.hotkey) hotkey.setCombo(settings.hotkey);
    if (patch.recordingSource) tray.refresh();
    // Reset (null) or a move from elsewhere: put the window where the setting says.
    if ('pillPosition' in patch) positionOverlay(overlay, settings.pillPosition);
    if (patch.hotkeyPaused !== undefined) {
      hotkey.setPaused(settings.hotkeyPaused);
      tray.refresh();
    }
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: [HIDDEN_ARG] });
    }
    if (patch.filmMode !== undefined) {
      send(Ch.FilmMode, { on: settings.filmMode });
      tray.refresh();
    }
    // Not over a saved flash: that would wipe "Add title" (or a title being typed).
    if (patch.showIdlePill !== undefined || patch.filmMode !== undefined) controller.refreshIdle();
    if (patch.theme) nativeTheme.themeSource = settings.theme; // fires 'updated' → caption buttons recolour
    toDashboard(Ch.SettingsChanged);
    return { ...settings };
  }

  const openedExternal: string[] = [];
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
    openedExternal,
  });

  app.on('before-quit', () => {
    isQuitting = true;
    autoPause.end(); // quitting mid-note must not leave the film paused
  });
  app.on('will-quit', () => {
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
      mediaPresses: () => mediaPresses,
      openedExternal, // URLs the dashboard asked to open in the browser
      pagesChanged: () => toDashboard(Ch.PagesChanged), // after editing pages through `store` directly
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
  app.whenReady().then(boot).catch((err) => {
    log.error('[boot] failed', err);
    app.quit();
  });
}
