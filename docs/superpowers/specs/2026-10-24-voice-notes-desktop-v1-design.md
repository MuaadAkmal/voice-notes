# Voice Notes Desktop — v1 Design

Date: 2026-10-24
Status: Approved in conversation, pending written-spec review

## 1. Intent

The user learns several languages and watches many films. When a new word or phrase comes up, they want to capture it as a voice note instantly — without leaving the film — and find it again later.

Existing tools (Obsidian, Notion, Evernote) lack frictionless in-place voice capture; Notion requires recording elsewhere and uploading.

**v1 success criteria**
- Pressing a global hotkey anywhere in Windows (including over a fullscreen video) starts recording without stealing focus.
- Releasing (or toggling off) saves the clip locally; nothing is lost on crash or disk error.
- A dashboard lists all notes by day and plays them back.

**Explicitly out of scope for v1** (pinned for later)
- Per-note metadata: language tag, source movie/show, typed meaning, active window title.
- Next.js web dashboard and cloud sync.
- Transcription / summarization (open-weight models).
- macOS / Linux builds (code should not preclude them, but only Windows is tested).

Working app name: **Voice Notes** (`voice-notes`). Rename is a one-line change in `package.json` / Forge config.

## 2. Reference: how Wispr Flow does it (v1.6.1209, inspected statically)

- Floating overlay: frameless `BrowserWindow` with `transparent: true`, `backgroundColor: '#00000000'`, `skipTaskbar`, `alwaysOnTop` + `setAlwaysOnTop(true, 'screen-saver')`, `setIgnoreMouseEvents(true, { forward: true })`, shown via `showInactive()`.
- Main dictation hotkey uses a native C# helper (low-level keyboard hook) because Electron `globalShortcut` has no key-up/hold events. `globalShortcut` is used only for secondary shortcuts.
- Stack: Electron Forge + webpack, React renderers, SQLite (`sqlite3`), Opus encoding in a worker.
- Storage: dictation audio as BLOB in SQLite (`History.audio`); long meeting audio tracked with upload flags and pushed to S3.

We mirror the overlay technique exactly, and replace the C# helper with `uiohook-napi` (same low-level hook, from Node).

## 3. Architecture

```
Electron main process
 ├─ HotkeyService      uiohook-napi → emits press/release; HotkeyGesture turns them into hold / double-tap / cancel
 ├─ RecorderController state machine: idle → recording → saving → idle
 ├─ NoteStore          Drizzle ORM + better-sqlite3 index; writes .webm files
 ├─ WindowManager      creates overlay + dashboard windows, tray
 ├─ Settings           JSON file in userData (electron-store-style, hand-rolled)
 └─ IPC                typed channels, exposed through contextBridge preloads
Overlay renderer (React)    pill UI; owns getUserMedia + MediaRecorder; sends audio bytes to main on stop
Dashboard renderer (React)  sidebar (Notes, Settings); list, playback, rename, delete
```

**Stack:** Electron Forge (Vite + TypeScript template), Electron 45, React 19, Tailwind CSS, Drizzle ORM + better-sqlite3, uiohook-napi, Vitest, Playwright (`_electron`).

**Unit boundaries**
| Unit | Purpose | Depends on |
|---|---|---|
| `HotkeyGesture` (pure) | Turns key down/up events + timestamps into `start-hold`, `stop`, `start-handsfree`, `cancel` | nothing (injected clock) |
| `HotkeyService` | Wires uiohook to `HotkeyGesture`, handles configured combo | uiohook-napi |
| `RecorderController` (pure-ish) | State machine; enforces min/max duration; tells overlay to start/stop; hands bytes to NoteStore | NoteStore interface, overlay messenger interface |
| `NoteStore` | Write file + row atomically; list/rename/delete; startup reconcile | better-sqlite3, fs |
| `Settings` | Load/save typed settings with defaults | fs |
| Overlay UI | Pill states, waveform, mic capture | IPC preload |
| Dashboard UI | Notes + Settings pages | IPC preload |

## 4. Data model & storage

Location: `%APPDATA%/Voice Notes/` (Electron `app.getPath('userData')`).
- `recordings/<uuid>.webm` — Opus in WebM, ~32 kbps mono.
- `voice-notes.sqlite` — index.
- `settings.json`.

```ts
notes {
  id          text primary key   // uuid v4, also the filename
  title       text not null      // default "Voice note · HH:mm"
  filePath    text not null      // relative to userData, e.g. recordings/<id>.webm
  durationMs  integer not null
  sizeBytes   integer not null
  mimeType    text not null      // 'audio/webm;codecs=opus'
  status      text not null      // 'ok' | 'missing'
  createdAt   integer not null   // epoch ms
  updatedAt   integer not null
  syncedAt    integer            // null in v1; reserved for future web sync
}
```

Migrations: an ordered array of SQL strings in `src/main/store/migrations.ts`, applied at startup and tracked with `PRAGMA user_version` (no migrations folder to ship in the package). Drizzle is used for typed queries only. Future metadata fields (see §1) are added as nullable columns.

**Write order:** write file to `recordings/<id>.webm.tmp` → fsync → rename to `.webm` → insert row. A crash between steps leaves an orphan file, which startup reconcile adopts.

**Startup reconcile:** rows whose file is absent → `status='missing'`; `.webm` files without a row → insert row with `durationMs = 0`, shown as "—" in the dashboard; stale `.tmp` files → deleted.

Why files + SQLite (not BLOBs, not a cloud DB): audio is the primary artifact to replay/export/sync; files are backup-friendly and survive DB corruption. A cloud DB (Neon/Prisma) would make capture network-dependent. Future web: Postgres (Neon) for metadata + object storage (R2/S3/Vercel Blob) for audio; Drizzle schema ports over.

## 5. Recording flow

**Hotkey (default `Alt+Win`, configurable; changed from Ctrl+Win on 2026-10-24 because it collides with Wispr Flow):**
- **Hold** ≥ 250 ms → push-to-talk; **release** → stop & save.
- **Double-tap** (a press < 250 ms, then a second key-down within 400 ms of its release) → hands-free; next **single tap** → stop & save.
- **Esc** while recording → cancel, discard.
- **Click pill** → toggle hands-free.

Hold detection: recording starts immediately on key-down (so no audio is lost); if the key is released before 250 ms, the gesture is treated as a tap — the capture is discarded unless it becomes the first half of a double-tap, in which case recording continues in hands-free mode.

**Sequence:**
1. Gesture → `RecorderController.start()` → IPC `recorder:start` to overlay.
2. Overlay: `getUserMedia` (selected mic, or default) → `MediaRecorder` (`audio/webm;codecs=opus`, 32 kbps, 250 ms timeslice). Pill expands: waveform (AnalyserNode) + timer.
3. Stop → overlay assembles Blob → `ArrayBuffer` → IPC `recorder:audio` with duration.
4. Main: discard if < 300 ms; else `NoteStore.create()`.
5. Overlay pill shows "Saved ✓" 1 s, collapses. Main broadcasts `notes:changed` to dashboard.

**Limits & resilience**
- Max length 5 min → auto-stop & save.
- Mic stream stays warm 30 s after a recording, then tracks are stopped (Windows mic indicator turns off).
- No mic / permission denied → pill red with "No microphone" for 3 s; error logged; controller returns to idle.
- Save failure → main keeps buffer in memory, pill shows "Save failed — Retry" (clickable); retry re-runs `NoteStore.create()`. Buffer dropped after a successful retry or on app quit (logged).
- Hotkey combo conflicts: uiohook observes without blocking, so other apps still receive the keys; Settings shows a hint about this.
- Single instance lock (`app.requestSingleInstanceLock`); second launch focuses the dashboard.

Logging: `electron-log` to `userData/logs/`.

## 6. Overlay window

- `BrowserWindow`: `transparent`, `frame: false`, `backgroundColor: '#00000000'`, `hasShadow: false`, `skipTaskbar`, `resizable/movable/minimizable/maximizable/fullscreenable: false`, `focusable: false`, `type: 'toolbar'`.
- `setAlwaysOnTop(true, 'screen-saver')`; `setIgnoreMouseEvents(true, { forward: true })`; renderer toggles click-through off when the pointer is over the pill (mouseenter/mouseleave → IPC).
- Size ~ 320×80, positioned bottom-center of the primary display's work area, 16 px above the taskbar; repositions on `display-metrics-changed`.
- Shown with `showInactive()`; never takes focus.
- Pill states: **idle** (small, ~40×8 dark capsule, subtle; hideable via setting), **recording** (expanded, red dot, waveform, mm:ss, mode label "Hold"/"Hands-free"), **saved**, **error**.

## 7. Dashboard window

Wispr Flow hub look: light neutral background, left sidebar, content area. Close → hide to tray.

- **Notes:** grouped by day (Today / Yesterday / date). Row: play/pause with progress bar, title (inline editable), time, duration, ⋯ menu (Rename, Show in folder, Delete with confirm). `missing` rows shown greyed with "File missing". Playback via `<audio>` from a custom protocol `note://<id>` registered in main (no `file://` exposure).
- **Settings:** hotkey recorder (press combo to set), microphone dropdown (`enumerateDevices`), Launch at login, Show pill when idle, Open recordings folder.
- **Tray:** Open dashboard, Pause hotkey (toggle), Quit.

## 8. Security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for both renderers; preloads expose a minimal typed API. IPC handlers validate payload shapes (zod). CSP restricts to `self` + `note:` + `data:`. Media permission granted only for `media` requests from the overlay via `session.setPermissionRequestHandler`.

## 9. Testing

- **Vitest unit:** `HotkeyGesture` (hold, release-before-threshold, double-tap, hands-free stop, Esc cancel) with fake clock; `RecorderController` (min/max duration, cancel, save failure + retry) with fake store/messenger; `NoteStore` against temp dir + temp SQLite (create, list order, rename, delete removes file, reconcile cases).
- **Playwright e2e (`_electron`):** launch with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and a temp `userData`; trigger start/stop through a test-only IPC hook (enabled by env var); assert file exists, row exists, note visible in dashboard, playback element loads.
- **Manual:** real hotkey over fullscreen VLC, Chrome (YouTube) and Netflix; verify no focus steal, pill visible, clip plays back.

## 10. Project layout

```
src/
  main/        index.ts, windows.ts, tray.ts, ipc.ts, protocol.ts, settings.ts
  main/hotkey/ gesture.ts, service.ts
  main/recorder/ controller.ts
  main/store/  schema.ts, note-store.ts, migrations.ts
  preload/     overlay.ts, dashboard.ts
  shared/      ipc-types.ts
  renderer/overlay/   index.html, main.tsx, Pill.tsx, useRecorder.ts
  renderer/dashboard/ index.html, main.tsx, NotesPage.tsx, SettingsPage.tsx
tests/unit/, tests/e2e/
```
