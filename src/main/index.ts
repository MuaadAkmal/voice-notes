import { app, type BrowserWindow, desktopCapturer, nativeTheme, net, screen, session } from 'electron';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { type AudioDevice, Ch, type NoteContext, type OverlayState, type Settings } from '../shared/ipc';
import { acceptsDrops } from '../shared/later';
import { keepExisting } from '../shared/home-widgets';
import { showFromTitle } from '../shared/show';
import { DICTATION_TTL_MS } from '../shared/dictation';
import { cleanTranscript } from '../shared/transcription';
import { DictationController } from './dictation/controller';
import { electronClipboard } from './dictation/clipboard';
import { pasteText } from './dictation/paste';
import { DragWatch, dropZone } from './drop/drag-watch';
import { HotkeyGesture } from './hotkey/gesture';
import { HotkeyService } from './hotkey/service';
import { LocalWhisper } from './local-whisper';
import { registerDashboardIpc, registerOverlayIpc } from './ipc';
import { ensureLaterPage, guardWidgets, saveDrop } from './later';
import { OverlayMouse } from './overlay-mouse';
import { AutoPause } from './media/auto-pause';
import { registerImageProtocol, registerNoteProtocol, registerNoteScheme } from './protocol';
import { RecorderController } from './recorder/controller';
import { loadSettings, normaliseLocal, REWIND_HOTKEY, saveSettings } from './settings';
import { foregroundWindow, modifiersHeld, pressPlayPause, sendCtrlV } from './win32';
import { NoteStore } from './store/note-store';
import { resolveEndpoint } from './transcription/endpoint';
import { transcribe } from './transcription/openai-client';
import { safeStorageCipher, Secrets } from './transcription/secrets';
import { TranscriptionService } from './transcription/service';
import { WavBridge } from './transcription/wav-bridge';
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
const DICTATION_PRUNE_MS = 60 * 60_000;
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
  // The built-in Review later page and its locked Home card always exist.
  const laterPatch = ensureLaterPage(settings, store.pages, randomUUID);
  if (laterPatch) Object.assign(settings, saveSettings(settingsFile, laterPatch));
  store.dictations.pruneOlderThan(DICTATION_TTL_MS);
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

  // Built-in transcription: engine and models are downloaded on demand into whisper/.
  const localWhisper: LocalWhisper = new LocalWhisper({
    root: path.join(userData, 'whisper'),
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
  if (checked !== settings) Object.assign(settings, saveSettings(settingsFile, { transcription: checked.transcription }));
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
    transcribe: async (audio, signal) => {
      const { transcription, transcribeLanguage } = settings;
      const ep = await endpoint();
      try {
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
  });
  overlay.webContents.on('render-process-gone', (_e, details) => {
    log.error('[overlay] renderer gone', details.reason);
    if (!overlay.isDestroyed()) overlay.webContents.reload();
  });

  let devices: AudioDevice[] = [];
  registerOverlayIpc({
    overlay,
    overlayMouse,
    gesture,
    controller,
    dictation,
    dictationGesture,
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
    onDrop: (payload) => {
      try {
        const result = saveDrop(payload, {
          pages: store.pages,
          getSettings: () => settings,
          updateSettings,
          source: () => getContext()?.show ?? null, // the browser the drag came from
          newId: randomUUID,
        });
        if (result === 'saved') toDashboard(Ch.PagesChanged);
        return result;
      } catch (err) {
        log.error('[later] drop not saved', err);
        throw err;
      }
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
    // A widget list from the dashboard (possibly stale) never loses the locked Review later card.
    patch = guardWidgets(patch, settings, randomUUID);
    Object.assign(settings, saveSettings(settingsFile, patch));
    if (patch.hotkey) hotkey.setCombo(settings.hotkey);
    if (patch.dictationHotkey) hotkey.setDictationCombo(settings.dictationHotkey);
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

  const secrets = new Secrets(path.join(userData, 'secrets.json'), safeStorageCipher);
  const wavBridge = new WavBridge();
  const transcription = new TranscriptionService({
    store,
    endpoint,
    secrets,
    toWav: (bytes, mimeType) =>
      wavBridge.request((requestId) => {
        if (!dashboard || dashboard.isDestroyed()) return false;
        dashboard.webContents.send(Ch.TranscriptionNeedWav, { requestId, bytes, mimeType });
        return true;
      }),
    notesChanged: () => toDashboard(Ch.NotesChanged),
    onStatus: (status) => {
      if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send(Ch.TranscriptionStatus, status);
    },
  });

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
    dictationsChanged: () => toDashboard(Ch.DictationsChanged),
    openedExternal,
    transcription,
    secrets,
    wavBridge,
    localWhisper,
  });

  app.on('before-quit', () => {
    isQuitting = true;
    autoPause.end(); // quitting mid-note must not leave the film paused
  });
  app.on('will-quit', () => {
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
      mediaPresses: () => mediaPresses,
      openedExternal, // URLs the dashboard asked to open in the browser
      pagesChanged: () => toDashboard(Ch.PagesChanged), // after editing pages through `store` directly
      transcription, // idle(): wait for queued transcriptions
      dictationGesture, // what Ctrl+Win does
      dictation,
      pasted, // texts a dictation would have pasted
      localWhisper, // setTestOverrides({ catalog, spawn }): fake downloads and engine
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
