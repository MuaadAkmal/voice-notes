import { app, type BrowserWindow, desktopCapturer, nativeTheme, session } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { type AudioDevice, Ch, type OverlayState, type Settings } from '../shared/ipc';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { registerDashboardIpc, registerOverlayIpc } from './ipc';
import { registerNoteProtocol, registerNoteScheme } from './protocol';
import { RecorderController } from './recorder/controller';
import { loadSettings, saveSettings } from './settings';
import { NoteStore } from './store/note-store';
import { createTray } from './tray';
import { applyTitleBarTheme, createDashboardWindow, createOverlayWindow, pillPositionOf, positionOverlay } from './windows';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

if (process.env.VOICE_NOTES_USER_DATA) app.setPath('userData', process.env.VOICE_NOTES_USER_DATA);
log.initialize();
registerNoteScheme();

const HIDDEN_ARG = '--hidden'; // passed by the login item so startup stays silent
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
  // themeSource drives prefers-color-scheme in every renderer; the dashboard maps that to html.dark.
  nativeTheme.themeSource = settings.theme;
  nativeTheme.on('updated', () => applyTitleBarTheme(dashboard));
  const store = NoteStore.open(userData);
  log.info('[store] reconcile', await store.reconcile());
  registerNoteProtocol(store);

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
  const idleState = (): OverlayState => ({ kind: 'idle', visible: settings.showIdlePill });

  const gesture = new HotkeyGesture();
  const controller = new RecorderController(
    {
      start: (deviceId, source) => send(Ch.RecorderStart, { deviceId, source }),
      stop: () => send(Ch.RecorderStop),
      cancel: () => send(Ch.RecorderCancel),
      setState: (s) => send(Ch.OverlayState, s),
    },
    store,
    {
      getDeviceId: () => settings.micDeviceId,
      getSource: () => settings.recordingSource,
      idleState,
      // Keep the gesture in step when recording ends without a key (auto-stop, mic error, watchdog).
      onIdle: () => gesture.reset(),
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
  overlay.webContents.on('did-finish-load', () => send(Ch.OverlayState, idleState()));
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
        if (!controller.lastSavedId) return;
        controller.holdFlash();
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
  });

  const hotkey = new HotkeyService(gesture);
  hotkey.setCombo(settings.hotkey);
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
    if (patch.showIdlePill !== undefined && controller.state === 'idle') send(Ch.OverlayState, idleState());
    if (patch.theme) nativeTheme.themeSource = settings.theme; // fires 'updated' → caption buttons recolour
    toDashboard(Ch.SettingsChanged);
    return { ...settings };
  }

  registerDashboardIpc({
    getDashboard: () => dashboard,
    store,
    hotkey,
    getSettings: () => ({ ...settings }),
    updateSettings,
    getDevices: () => devices,
    notesChanged: () => toDashboard(Ch.NotesChanged),
    foldersChanged: () => toDashboard(Ch.FoldersChanged),
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('will-quit', () => {
    hotkey.stop();
    store.close();
  });

  if (process.env.VOICE_NOTES_TEST === '1') {
    (globalThis as Record<string, unknown>).__voiceNotes = { gesture, controller, store };
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
