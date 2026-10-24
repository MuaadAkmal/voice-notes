# Voice Notes Desktop v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows Electron app where a global hotkey shows a floating pill that records a voice note to a local `.webm` file indexed in SQLite, plus a dashboard to play, rename and delete notes.

**Architecture:** Pure, unit-tested core in the main process (`HotkeyGesture`, `RecorderController`, `NoteStore`, `settings`) wired to Electron in thin adapters (uiohook, windows, IPC, tray). Two sandboxed React renderers: the overlay owns mic capture via `MediaRecorder`; the dashboard lists notes and plays them through a `note://` protocol.

**Tech Stack:** Electron 45, Electron Forge 8 (vite-typescript template), TypeScript, React 19, Tailwind CSS 4 (`@tailwindcss/vite`), better-sqlite3 + drizzle-orm, uiohook-napi, zod, electron-log, Vitest, Playwright (`_electron`).

**Spec:** `docs/superpowers/specs/2026-10-24-voice-notes-desktop-v1-design.md`

## Global Constraints

- Windows only is tested; no macOS/Linux-specific code paths required, none forbidden.
- App name `Voice Notes`, package name `voice-notes`; data in `app.getPath('userData')` = `%APPDATA%/Voice Notes/`.
- Files: `recordings/<uuid>.webm`, `voice-notes.sqlite`, `settings.json`, logs via electron-log in `userData/logs/`.
- Audio: `audio/webm;codecs=opus`, `audioBitsPerSecond: 32000`, mono, `MediaRecorder` timeslice 250 ms.
- Timing constants: hold threshold 250 ms; double-tap window 400 ms; min clip 300 ms; max clip 300 000 ms (5 min); mic warm 30 000 ms; "Saved ✓" 1 000 ms; no-mic error 3 000 ms.
- Default hotkey `Ctrl+Win` (uiohook keycodes `UiohookKey.Ctrl` + `UiohookKey.Meta`, left variants; right variants also count).
- Default title `Voice note · HH:mm` (24-hour, local time, zero-padded).
- Both renderers: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; IPC payloads from renderers validated with zod in main.
- Native modules (`better-sqlite3`, `uiohook-napi`) are built for Electron's ABI, so unit tests run under Electron-as-Node (`ELECTRON_RUN_AS_NODE=1`), never plain Node.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Key auto-repeat:** Windows sends repeated key-down while a key is held; a held hotkey must produce exactly one `start` and one `stop` → pinned in Task 3 (`ignores auto-repeat keydown`).
2. **Corrupt or partial `settings.json`** (user edits it, crash mid-write): app must start with defaults merged over whatever is valid, not crash → pinned in Task 2 (`falls back to defaults on invalid JSON`, `merges partial settings`).
3. **Audio arriving after cancel** (Esc pressed, overlay still flushes `recorder:audio`): must not create a note → pinned in Task 5 (`ignores audio after cancel`).
4. **Playback of WebM from MediaRecorder** has no duration header, so `<audio>.duration` is `Infinity`; the progress bar must use the stored `durationMs` → pinned in Task 7 (`formatDuration` + progress uses `note.durationMs`).
5. **Deleting a note whose file is already gone** (`status: 'missing'`) must still remove the row without throwing → pinned in Task 4 (`delete tolerates missing file`).

---

## File Structure

```
package.json, forge.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
vite.main.config.ts, vite.preload.config.ts, vite.overlay.config.ts, vite.dashboard.config.ts
src/shared/ipc.ts               channel names + payload types + zod schemas (single source of truth)
src/shared/format.ts            formatDuration, defaultTitle, dayGroupLabel (pure, used by main + dashboard)
src/main/index.ts               app bootstrap: single-instance, wires everything
src/main/settings.ts            loadSettings / saveSettings
src/main/hotkey/gesture.ts      HotkeyGesture (pure state machine)
src/main/hotkey/service.ts      HotkeyService (uiohook adapter) + captureCombo
src/main/recorder/controller.ts RecorderController
src/main/store/schema.ts        drizzle table
src/main/store/migrations.ts    ordered SQL + migrate(db)
src/main/store/note-store.ts    NoteStore
src/main/windows.ts             createOverlayWindow, createDashboardWindow, positionOverlay
src/main/ipc.ts                 registerIpc (handlers + validation)
src/main/protocol.ts            registerNoteProtocol
src/main/tray.ts                createTray
src/preload/overlay.ts, src/preload/dashboard.ts
src/renderer/overlay/{index.html, main.tsx, Pill.tsx, useRecorder.ts, overlay.css}
src/renderer/dashboard/{index.html, main.tsx, App.tsx, NotesPage.tsx, NoteRow.tsx, SettingsPage.tsx, dashboard.css}
src/renderer/env.d.ts           window.overlayApi / window.dashboardApi types
tests/unit/*.test.ts, tests/e2e/record.spec.ts
```

---

### Task 1: Scaffold Electron Forge + Vite + React + Tailwind + test runners

**Files:**
- Create: everything at repo root listed above except `src/main/**` modules beyond `index.ts`; `src/renderer/*/index.html` + `main.tsx` stubs; `tests/unit/smoke.test.ts`
- Modify: `CLAUDE.md` (commands + architecture), `.gitignore` (add `.vite/`, `out/` already present)

**Interfaces:**
- Produces: Forge Vite globals `OVERLAY_VITE_DEV_SERVER_URL`, `OVERLAY_VITE_NAME`, `DASHBOARD_VITE_DEV_SERVER_URL`, `DASHBOARD_VITE_NAME`; preload build outputs `.vite/build/overlay-preload.js`, `.vite/build/dashboard-preload.js`; npm scripts `start`, `package`, `make`, `test`, `test:e2e`, `typecheck`.

- [ ] **Step 1: Generate the template in the scratchpad and copy it in** (the repo dir is not empty)

Run: `npx create-electron-app@latest voice-notes --template=vite-typescript` in a temp dir, copy all files except `.git` into the repo root, set `"name": "voice-notes"`, `"productName": "Voice Notes"`.

- [ ] **Step 2: Install dependencies**

```
npm i react@19 react-dom@19 better-sqlite3 drizzle-orm uiohook-napi zod electron-log
npm i -D electron@45 @types/react @types/react-dom @types/better-sqlite3 tailwindcss @tailwindcss/vite @vitejs/plugin-react vitest @playwright/test @electron/rebuild cross-env @electron-forge/plugin-auto-unpack-natives
```
Add `"postinstall": "electron-rebuild -f -w better-sqlite3,uiohook-napi"`.

- [ ] **Step 3: Configure Forge for two renderers and two preloads**

In `forge.config.ts` VitePlugin: `build` = `[{entry:'src/main/index.ts', config:'vite.main.config.ts', target:'main'}, {entry:'src/preload/overlay.ts', config:'vite.preload.config.ts', target:'preload'}, {entry:'src/preload/dashboard.ts', config:'vite.preload.config.ts', target:'preload'}]`; `renderer` = `[{name:'overlay', config:'vite.overlay.config.ts'}, {name:'dashboard', config:'vite.dashboard.config.ts'}]`. Each renderer config sets `root: 'src/renderer/<name>'` and plugins `react()` + `tailwindcss()`. `vite.main.config.ts`: `build.rollupOptions.external: ['better-sqlite3', 'uiohook-napi']`. Add `AutoUnpackNativesPlugin`. Keep the template's FusesPlugin.

- [ ] **Step 4: Minimal `src/main/index.ts`** that opens a dashboard window loading the dashboard renderer, whose `main.tsx` renders `<h1 className="text-2xl">Voice Notes</h1>`.

- [ ] **Step 5: Test runner**

`vitest.config.ts`: `test.include: ['tests/unit/**/*.test.ts']`, `environment: 'node'`. Script: `"test": "cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run"`. `tests/unit/smoke.test.ts`: `import Database from 'better-sqlite3'; expect(new Database(':memory:').prepare('select 1 as x').get()).toEqual({x:1})`.

- [ ] **Step 6: Verify**

Run: `npm test` → Expected: 1 passed (proves native module loads under Electron ABI).
Run: `npx tsc --noEmit` → Expected: no errors.
Run: `npm start` → Expected: window shows "Voice Notes" heading styled by Tailwind; close it.

- [ ] **Step 7: Update `CLAUDE.md`** with the commands from Step 6, the Electron-as-Node test note, and the File Structure block above. Remove the "no application code yet" section.

- [ ] **Step 8: Commit** `chore: scaffold electron forge + vite + react app`

---

### Task 2: Shared IPC contract, formatting helpers, settings

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/format.ts`, `src/main/settings.ts`
- Test: `tests/unit/format.test.ts`, `tests/unit/settings.test.ts`

**Interfaces:**
- Produces (`src/shared/ipc.ts`):
  ```ts
  export type Note = { id: string; title: string; filePath: string; durationMs: number; sizeBytes: number;
    mimeType: string; status: 'ok' | 'missing'; createdAt: number; updatedAt: number; syncedAt: number | null };
  export type Settings = { hotkey: number[]; hotkeyLabel: string; micDeviceId: string | null;
    launchAtLogin: boolean; showIdlePill: boolean; hotkeyPaused: boolean };
  export type RecordingMode = 'hold' | 'handsfree';
  export type OverlayState =
    | { kind: 'idle'; visible: boolean }
    | { kind: 'recording'; mode: RecordingMode; startedAt: number }
    | { kind: 'saved' }
    | { kind: 'error'; message: string; retry: boolean };
  export type AudioPayload = { bytes: ArrayBuffer; durationMs: number; mimeType: string };
  export const Ch = {
    // main → overlay
    RecorderStart: 'recorder:start',   // payload { deviceId: string | null }
    RecorderStop: 'recorder:stop', RecorderCancel: 'recorder:cancel',
    OverlayState: 'overlay:state',     // payload OverlayState
    // overlay → main
    RecorderAudio: 'recorder:audio', RecorderError: 'recorder:error', // { message: string }
    OverlayPointer: 'overlay:pointer', // { over: boolean }
    OverlayClick: 'overlay:click', OverlayRetry: 'overlay:retry',
    // dashboard ↔ main (invoke)
    NotesList: 'notes:list', NotesRename: 'notes:rename', NotesDelete: 'notes:delete', NotesReveal: 'notes:reveal',
    SettingsGet: 'settings:get', SettingsSet: 'settings:set', HotkeyCapture: 'hotkey:capture',
    OpenRecordingsFolder: 'app:open-recordings-folder',
    // main → dashboard
    NotesChanged: 'notes:changed', SettingsChanged: 'settings:changed',
  } as const;
  export const AudioPayloadSchema, RenameSchema ({id: uuid, title: 1..200 chars trimmed}), IdSchema, SettingsPatchSchema (partial Settings), PointerSchema, ErrorSchema  // zod
  ```
- Produces (`src/shared/format.ts`): `formatDuration(ms: number): string`, `defaultTitle(date: Date): string`, `dayGroupLabel(ts: number, now: number): string`
- Produces (`src/main/settings.ts`): `DEFAULT_SETTINGS: Settings`, `loadSettings(file: string): Settings`, `saveSettings(file: string, patch: Partial<Settings>): Settings`

- [ ] **Step 1: Write failing tests**

```ts
// format.test.ts
expect(formatDuration(0)).toBe('—');
expect(formatDuration(4_200)).toBe('0:04');
expect(formatDuration(65_000)).toBe('1:05');
expect(defaultTitle(new Date(2026, 9, 24, 9, 5))).toBe('Voice note · 09:05');
const now = new Date(2026, 9, 24, 15).getTime();
expect(dayGroupLabel(new Date(2026, 9, 24, 1).getTime(), now)).toBe('Today');
expect(dayGroupLabel(new Date(2026, 9, 23, 23).getTime(), now)).toBe('Yesterday');
expect(dayGroupLabel(new Date(2026, 9, 20).getTime(), now)).toBe('Tue, 20 Oct 2026'); // en-GB weekday short, day, month short, year
// settings.test.ts (tmp dir per test)
it('returns defaults when file absent')            // deep-equals DEFAULT_SETTINGS; hotkeyLabel 'Ctrl+Win'
it('falls back to defaults on invalid JSON')       // file contains '{not json' → DEFAULT_SETTINGS, no throw
it('merges partial settings')                      // file {"showIdlePill":false,"bogus":1} → defaults with showIdlePill false, no 'bogus' key
it('saveSettings persists and returns merged')     // save {micDeviceId:'abc'} then load → micDeviceId 'abc'
it('ignores wrongly-typed fields')                 // {"launchAtLogin":"yes"} → launchAtLogin false
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** the three files. `loadSettings` parses each known key with its zod field schema and keeps the default on failure. `saveSettings` writes to `settings.json.tmp` then renames.

- [ ] **Step 4: Run** `npm test` → Expected: all pass.

- [ ] **Step 5: Commit** `feat: shared ipc contract, format helpers, settings`

---

### Task 3: HotkeyGesture state machine

**Files:**
- Create: `src/main/hotkey/gesture.ts`
- Test: `tests/unit/gesture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GestureEvent = 'start' | 'handsfree' | 'stop' | 'discard' | 'cancel';
  export class HotkeyGesture {
    constructor(opts?: { holdMs?: number /*250*/; doubleTapMs?: number /*400*/ });
    onEvent(listener: (e: GestureEvent) => void): void;
    keyDown(): void; keyUp(): void;   // combo fully pressed / any combo key released
    escape(): void;                   // Esc key
    toggle(): void;                   // pill click
    reset(): void;                    // force idle, clear timers, emit nothing
  }
  ```
  Uses `Date.now()` and `setTimeout` (tests use `vi.useFakeTimers()`).

States: `idle` → keyDown: emit `start`, → `holding`. `holding` → keyUp: if held ≥ holdMs emit `stop` → `idle`; else → `tapWait` and arm doubleTapMs timer (expiry: emit `discard` → `idle`). `tapWait` → keyDown: clear timer, emit `handsfree` → `secondTap`. `secondTap` → keyUp → `handsfree`. `handsfree` → keyDown: emit `stop` → `stopping`; `stopping` → keyUp → `idle`. Esc in `holding|tapWait|secondTap|handsfree`: emit `cancel` → `idle`. `toggle()`: in `idle` emit `start` then `handsfree` → `handsfree`; in `handsfree` emit `stop` → `idle`; else ignored. keyDown while key already down is ignored (auto-repeat).

- [ ] **Step 1: Write failing tests** (fake timers; helper `events: GestureEvent[]` collected via `onEvent`)

```ts
it('hold ≥250ms then release → start, stop')           // down; advance 300; up → ['start','stop']
it('short tap with no follow-up → start, discard')     // down; advance 100; up; advance 401 → ['start','discard']
it('double tap → start, handsfree; next tap → stop')   // down;+100;up;+200;down;+50;up;+3000;down;up → ['start','handsfree','stop']
it('second tap after 400ms is a new start')            // down;+100;up;+450 → discard; down → [...,'start']
it('escape while holding → cancel')                    // down;+500;escape → ['start','cancel']; later up emits nothing
it('escape in handsfree → cancel')
it('ignores auto-repeat keydown')                      // down; down; down;+300; up → ['start','stop']
it('toggle from idle → start, handsfree; toggle again → stop')
it('escape when idle emits nothing')
```

- [ ] **Step 2: Run** `npm test -- gesture` → Expected: FAIL.
- [ ] **Step 3: Implement** `HotkeyGesture` per the state table above.
- [ ] **Step 4: Run** `npm test -- gesture` → Expected: 9 passed.
- [ ] **Step 5: Commit** `feat: hotkey gesture state machine`

---

### Task 4: NoteStore (schema, migrations, files, reconcile)

**Files:**
- Create: `src/main/store/schema.ts`, `src/main/store/migrations.ts`, `src/main/store/note-store.ts`
- Test: `tests/unit/note-store.test.ts`

**Interfaces:**
- Consumes: `Note` from `src/shared/ipc.ts`; `defaultTitle` from `src/shared/format.ts`.
- Produces:
  ```ts
  export type NewAudio = { bytes: Buffer; durationMs: number; mimeType: string };
  export class NoteStore {
    static open(rootDir: string, now?: () => number): NoteStore;   // creates rootDir/recordings, opens rootDir/voice-notes.sqlite, migrates
    create(audio: NewAudio): Promise<Note>;
    list(): Note[];                       // createdAt DESC
    get(id: string): Note | undefined;
    rename(id: string, title: string): Note;  // throws Error('Note not found') if absent; bumps updatedAt
    delete(id: string): Promise<void>;     // removes file (ENOENT ignored) and row
    reconcile(): Promise<{ missing: number; adopted: number; tmpRemoved: number }>;
    absolutePath(note: Note): string;
    readonly recordingsDir: string;
    close(): void;
  }
  ```
  `migrations.ts`: `export const MIGRATIONS: string[]` (index 0 = create `notes` table with the spec §4 columns + index on `createdAt`), `export function migrate(db: Database.Database): void` applying `MIGRATIONS.slice(user_version)` in one transaction each and setting `PRAGMA user_version`. Open DB with `journal_mode = WAL`.

- [ ] **Step 1: Write failing tests** (each test: fresh `fs.mkdtempSync` root, fixed `now`)

```ts
it('create writes file and row')        // bytes Buffer.from('abc'); file recordings/<id>.webm exists with 'abc';
                                        // note.sizeBytes 3, status 'ok', title 'Voice note · HH:mm' of now, filePath `recordings/${id}.webm`, syncedAt null
it('create leaves no .tmp file')
it('list returns newest first')
it('rename updates title and updatedAt')
it('rename unknown id throws')          // toThrow('Note not found')
it('delete removes file and row')
it('delete tolerates missing file')     // unlink file manually first; delete resolves; list() empty
it('reconcile marks missing rows')      // delete file on disk → reconcile → {missing:1}; get(id).status 'missing'
it('reconcile adopts orphan files')     // write recordings/<uuid>.webm without row → {adopted:1}; adopted note durationMs 0, createdAt = file mtime
it('reconcile removes stale tmp files') // recordings/x.webm.tmp → {tmpRemoved:1}, file gone
it('reopen keeps data and does not re-run migrations') // create, close, open again → list length 1
```

- [ ] **Step 2: Run** `npm test -- note-store` → Expected: FAIL.
- [ ] **Step 3: Implement.** `create`: `randomUUID()`, write `<id>.webm.tmp` with `fs.promises.open` + `write` + `sync` + `close`, `rename` to `.webm`, then insert. Orphan uuid check: filename stem must match the uuid regex, else ignored.
- [ ] **Step 4: Run** `npm test -- note-store` → Expected: 11 passed.
- [ ] **Step 5: Commit** `feat: note store with sqlite index and file storage`

---

### Task 5: RecorderController

**Files:**
- Create: `src/main/recorder/controller.ts`
- Test: `tests/unit/controller.test.ts`

**Interfaces:**
- Consumes: `GestureEvent` (Task 3), `NewAudio`/`Note` (Task 4), `OverlayState`, `RecordingMode` (Task 2).
- Produces:
  ```ts
  export interface OverlayPort {
    start(deviceId: string | null): void; stop(): void; cancel(): void;
    setState(state: OverlayState): void;
  }
  export interface NoteSink { create(audio: NewAudio): Promise<Note> }
  export class RecorderController {
    constructor(overlay: OverlayPort, sink: NoteSink, opts: {
      getDeviceId: () => string | null; onSaved: (n: Note) => void;
      minMs?: number /*300*/; maxMs?: number /*300_000*/; savedMs?: number /*1000*/; errorMs?: number /*3000*/;
      idleState: () => OverlayState /* {kind:'idle', visible: settings.showIdlePill} */ });
    readonly state: 'idle' | 'recording' | 'stopping' | 'saving' | 'failed';
    handleGesture(e: GestureEvent): void;
    onAudio(a: NewAudio): Promise<void>;
    onCaptureError(message: string): void;
    retry(): Promise<void>;
  }
  ```

Behavior: `start` (idle only) → `overlay.start(deviceId)`, `setState({kind:'recording', mode:'hold', startedAt})`, arm max timer → `recording`. `handsfree` → `setState` with mode `'handsfree'` (same startedAt). `stop` → `overlay.stop()` → `stopping`. `discard`/`cancel` → `overlay.cancel()`, `setState(idleState())` → `idle`. Max timer fires → same as `stop`. `onAudio` only in `stopping`: if `durationMs < minMs` → idle state, no save; else `saving` → `sink.create`: success → `onSaved`, `setState({kind:'saved'})`, after savedMs `setState(idleState())` → `idle`; failure → keep audio, `setState({kind:'error', message:'Save failed — Retry', retry:true})` → `failed`. `retry()` only in `failed`. In `failed`, a `start` gesture is ignored (buffer must not be lost silently). `onCaptureError` → `setState({kind:'error', message, retry:false})`, after errorMs → idle.

- [ ] **Step 1: Write failing tests** (fake timers; fake overlay records calls; fake sink resolves a Note or rejects)

```ts
it('start → overlay.start with device id and recording state (mode hold)')
it('handsfree switches mode, keeps startedAt')
it('stop then audio ≥300ms saves, shows saved, then idle after 1000ms')
it('audio <300ms is dropped without save')          // durationMs 299 → sink.create not called
it('ignores audio after cancel')                    // start, cancel, onAudio → sink.create not called
it('auto-stops at max duration')                    // start; advance 300_000 → overlay.stop called
it('save failure shows retry; retry saves the same bytes')
it('start gesture ignored while failed')
it('capture error shows message then idle after 3000ms')
```

- [ ] **Step 2: Run** `npm test -- controller` → Expected: FAIL.
- [ ] **Step 3: Implement** `RecorderController`.
- [ ] **Step 4: Run** `npm test -- controller` → Expected: 9 passed.
- [ ] **Step 5: Commit** `feat: recorder controller`

---

### Task 6: Overlay window, mic capture, hotkey wiring (first end-to-end recording)

**Files:**
- Create: `src/main/windows.ts` (overlay parts), `src/main/hotkey/service.ts`, `src/main/ipc.ts` (overlay handlers), `src/preload/overlay.ts`, `src/renderer/overlay/{Pill.tsx, useRecorder.ts, overlay.css}`, `src/renderer/env.d.ts`
- Modify: `src/main/index.ts`, `src/renderer/overlay/main.tsx`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  ```ts
  // windows.ts
  export function createOverlayWindow(): BrowserWindow;
  export function positionOverlay(win: BrowserWindow): void;          // 320×80, bottom-center of primary workArea, 16px margin
  // hotkey/service.ts
  export class HotkeyService {
    constructor(gesture: HotkeyGesture);
    start(): void; stop(): void;
    setCombo(keycodes: number[]): void; setPaused(p: boolean): void;
    captureCombo(): Promise<{ keycodes: number[]; label: string }>;   // resolves on first release after ≥1 key down; 10s timeout rejects
  }
  // preload/overlay.ts → window.overlayApi
  { onStart(cb: (p:{deviceId:string|null}) => void), onStop(cb), onCancel(cb), onState(cb: (s: OverlayState) => void),
    sendAudio(a: AudioPayload), sendError(message: string), setPointerOver(over: boolean), click(), retry() }
  ```

- [ ] **Step 1: `createOverlayWindow`**: BrowserWindow options exactly per spec §6 (`transparent`, `frame:false`, `backgroundColor:'#00000000'`, `hasShadow:false`, `skipTaskbar`, `resizable/movable/minimizable/maximizable/fullscreenable:false`, `focusable:false`, `type:'toolbar'`, `show:false`, webPreferences sandbox + overlay preload). Then `setAlwaysOnTop(true,'screen-saver')`, `setIgnoreMouseEvents(true,{forward:true})`, `positionOverlay`, `showInactive()` on `ready-to-show`. Reposition on `screen` `display-metrics-changed` / `display-added` / `display-removed`. `session.setPermissionRequestHandler`: allow `media` only when `webContents === overlay.webContents`.

- [ ] **Step 2: `HotkeyService`**: `uIOhook.on('keydown'|'keyup')`, maintain a pressed-keycode set; treat left/right Ctrl (`Ctrl`/`CtrlRight`), Win (`Meta`/`MetaRight`), Shift, Alt as equivalent. Combo transitions not-all-pressed → all-pressed call `gesture.keyDown()`; all-pressed → not → `gesture.keyUp()`. `Escape` keydown → `gesture.escape()`. Paused → ignore everything. Label built from key names (`Ctrl`, `Win`, `Shift`, `Alt`, letters), joined by `+`.

- [ ] **Step 3: Overlay renderer.** `useRecorder` keeps a cached `MediaStream` (constraints `{audio:{deviceId: deviceId ? {exact: deviceId} : undefined, channelCount:1}}`) released 30 000 ms after the last stop; on start creates `MediaRecorder(stream, {mimeType:'audio/webm;codecs=opus', audioBitsPerSecond:32000})`, `start(250)`; on stop concatenates chunks to a Blob → `arrayBuffer()` → `sendAudio({bytes, durationMs: performance.now()-t0, mimeType})`; on cancel stops recorder and drops chunks; getUserMedia failure → `sendError('No microphone')`. Exposes an `AnalyserNode` for the waveform.
  `Pill` renders by `OverlayState`: idle (40×8 dark capsule, hidden when `visible:false`), recording (expanded ~220×40, red dot, 24-bar waveform from analyser via rAF, `m:ss` timer from `startedAt`, label "Hold"/"Hands-free"), saved ("Saved ✓"), error (red, message; clickable "Retry" when `retry`). `onMouseEnter/Leave` on the pill → `setPointerOver`; click → `click()` (or `retry()` in error+retry). Body background transparent.

- [ ] **Step 4: Wire in `src/main/index.ts` and `ipc.ts`**: single-instance lock; open `NoteStore` at `userData`, `await reconcile()`; load settings; build `HotkeyGesture` → `RecorderController` (overlay port sends `Ch.RecorderStart/Stop/Cancel/OverlayState` to overlay webContents); `gesture.onEvent(e => controller.handleGesture(e))`; IPC: `RecorderAudio` (validate with `AudioPayloadSchema`, `Buffer.from(bytes)`) → `controller.onAudio`; `RecorderError` → `onCaptureError`; `OverlayPointer` → `overlay.setIgnoreMouseEvents(!over, {forward:true})`; `OverlayClick` → `gesture.toggle()`; `OverlayRetry` → `controller.retry()`. `onSaved` → broadcast `Ch.NotesChanged`. Stop uIOhook on `will-quit`. Logging via electron-log. If `process.env.VOICE_NOTES_USER_DATA` is set, `app.setPath('userData', it)` before `ready`; if `process.env.VOICE_NOTES_TEST === '1'`, set `globalThis.__voiceNotes = { gesture, controller, store }`.

- [ ] **Step 5: Verify** `npx tsc --noEmit` → no errors; `npm test` → all pass.

- [ ] **Step 6: Manual check** `npm start`: idle pill visible bottom-center; hold Ctrl+Win 2 s while focused in Notepad → pill shows waveform + timer, Notepad keeps focus, release → "Saved ✓"; `%APPDATA%/Voice Notes/recordings/` contains a `.webm` that plays in a media player. Double-tap → hands-free; tap → saved. Esc while recording → nothing saved. Clicks next to the pill reach the window below.

- [ ] **Step 7: Commit** `feat: floating overlay with hotkey-driven recording`

---

### Task 7: Dashboard, note protocol, settings page, tray

**Files:**
- Create: `src/main/protocol.ts`, `src/main/tray.ts`, `src/preload/dashboard.ts`, `src/renderer/dashboard/{App.tsx, NotesPage.tsx, NoteRow.tsx, SettingsPage.tsx, dashboard.css}`, `assets/tray.png` (16×16 + `@2x`)
- Modify: `src/main/windows.ts` (+`createDashboardWindow`), `src/main/ipc.ts`, `src/main/index.ts`, `src/renderer/dashboard/main.tsx`
- Test: `tests/unit/group.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6.
- Produces:
  ```ts
  // protocol.ts — call protocol.registerSchemesAsPrivileged([{scheme:'note', privileges:{stream:true, supportFetchAPI:true, standard:true, secure:true}}]) before ready
  export function registerNoteProtocol(store: NoteStore): void;   // note://<id> → net.fetch(pathToFileURL(store.absolutePath(note))); 404 if unknown or missing
  export function createTray(actions: { openDashboard(): void; togglePause(): boolean; quit(): void }): Tray;
  export function createDashboardWindow(): BrowserWindow;          // 960×640, min 720×480, close → hide unless app.isQuitting
  // shared/format.ts (add)
  export function groupByDay(notes: Note[], now: number): { label: string; notes: Note[] }[];
  // preload/dashboard.ts → window.dashboardApi
  { listNotes(): Promise<Note[]>; renameNote(id, title): Promise<Note>; deleteNote(id): Promise<void>; revealNote(id): Promise<void>;
    getSettings(): Promise<Settings>; setSettings(patch: Partial<Settings>): Promise<Settings>; captureHotkey(): Promise<{keycodes:number[]; label:string}>;
    openRecordingsFolder(): Promise<void>; onNotesChanged(cb): () => void; onSettingsChanged(cb): () => void }
  ```

- [ ] **Step 1: Write failing test** `group.test.ts`: `groupByDay` on notes at Today 10:00, Today 09:00, Yesterday 20:00 → `[{label:'Today', notes:[10:00, 09:00]}, {label:'Yesterday', notes:[20:00]}]` (input order preserved within group).
- [ ] **Step 2: Run** `npm test -- group` → FAIL. **Step 3:** implement `groupByDay` in `src/shared/format.ts`. **Step 4:** run → PASS.

- [ ] **Step 5: Main side.** IPC handlers (`ipcMain.handle`, zod-validated): `NotesList` → `store.list()`; `NotesRename` → `store.rename`, broadcast `NotesChanged`; `NotesDelete` → `store.delete`, broadcast; `NotesReveal` → `shell.showItemInFolder`; `SettingsGet/Set` → settings module; on set apply side effects: `hotkey` → `hotkeyService.setCombo`, `hotkeyPaused` → `setPaused`, `launchAtLogin` → `app.setLoginItemSettings({openAtLogin})`, `showIdlePill` → push idle `OverlayState` if controller idle; broadcast `SettingsChanged`. `HotkeyCapture` → `hotkeyService.captureCombo()`. `OpenRecordingsFolder` → `shell.openPath(store.recordingsDir)`. Tray: Open dashboard / Pause hotkey (checkbox, mirrors `hotkeyPaused`) / Quit (`app.isQuitting = true; app.quit()`). Dashboard opens on first launch and on second-instance; CSP meta in both `index.html`: `default-src 'self'; media-src 'self' note:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.

- [ ] **Step 6: Dashboard UI** (light neutral, Wispr-hub style): left sidebar 220px with app name and nav "Notes" / "Settings"; content area.
  - `NotesPage`: loads `listNotes()`, re-loads on `onNotesChanged`; renders `groupByDay` sections; empty state "No notes yet — hold Ctrl+Win anywhere to record" (uses current `hotkeyLabel`).
  - `NoteRow`: play/pause button driving a single shared `<audio>` (only one note plays at a time; `src = note://<id>`); progress bar width = `currentTime*1000 / note.durationMs` (clamped 0–1; hidden when `durationMs` is 0); title inline-editable (Enter/blur saves, Esc reverts, empty → revert); time `HH:mm`; `formatDuration(durationMs)`; ⋯ menu Rename / Show in folder / Delete (`confirm('Delete this note?')`). `status:'missing'` → row greyed, play disabled, text "File missing".
  - `SettingsPage`: Hotkey (shows label, "Change" button → "Press keys…" → `captureHotkey()` → `setSettings({hotkey, hotkeyLabel})`; hint "Other apps still receive these keys"); Microphone `<select>` from `navigator.mediaDevices.enumerateDevices()` filtered to `audioinput` + "System default" (`null`); toggles Launch at login, Show pill when idle; button Open recordings folder.

- [ ] **Step 7: Verify** `npx tsc --noEmit` clean; `npm test` all pass.
- [ ] **Step 8: Manual check** `npm start`: record two notes → both appear under "Today" without refreshing; play one (progress moves, the other stops if playing); rename persists after restart; delete removes row and file; change hotkey to `Ctrl+Shift+Space`-style combo and record with it; toggle idle pill off → pill hidden when idle but shows while recording; close window → app stays in tray; tray Quit exits.
- [ ] **Step 9: Commit** `feat: dashboard, note playback, settings and tray`

---

### Task 8: Packaging + end-to-end test

**Files:**
- Modify: `forge.config.ts`, `package.json`
- Create: `playwright.config.ts`, `tests/e2e/record.spec.ts`

**Interfaces:**
- Consumes: test hooks from Task 6 (`VOICE_NOTES_USER_DATA`, `VOICE_NOTES_TEST`, `globalThis.__voiceNotes`).

- [ ] **Step 1: Package native modules.** Forge's Vite plugin does not ship `node_modules`; add a `hooks.packageAfterCopy(config, buildPath)` that copies `better-sqlite3`, `uiohook-napi` and their runtime deps (`bindings`, `file-uri-to-path`, `node-gyp-build`) from `node_modules` into `buildPath/node_modules`. Run `npm run package` → Expected: `out/Voice Notes-win32-x64/Voice Notes.exe` exists and launching it shows the pill and dashboard.

- [ ] **Step 2: Write the e2e test** `tests/e2e/record.spec.ts`:

```ts
// launch: _electron.launch({ executablePath: 'out/Voice Notes-win32-x64/Voice Notes.exe',
//   args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
//   env: { ...process.env, VOICE_NOTES_TEST: '1', VOICE_NOTES_USER_DATA: <fresh tmp dir> } })
test('records a note via gesture and shows it in the dashboard', async () => {
  // app.evaluate(() => globalThis.__voiceNotes.gesture.toggle())    → start + handsfree
  // wait 1500ms; app.evaluate(() => globalThis.__voiceNotes.gesture.toggle()) → stop
  // expect.poll(() => app.evaluate(() => globalThis.__voiceNotes.store.list().length)).toBe(1)
  // file at <tmp>/recordings/<id>.webm exists and size > 0
  // dashboard window: locator('text=Voice note ·') visible; 'Today' heading visible
});
test('cancel does not create a note', ...)  // toggle → wait 500 → gesture.escape() → wait 1000 → list().length 0
```
Script: `"test:e2e": "npm run package && playwright test"`; `playwright.config.ts` `testDir: 'tests/e2e'`, `timeout: 60_000`, `workers: 1`.

- [ ] **Step 3: Run** `npm run test:e2e` → Expected: 2 passed.
- [ ] **Step 4: Update `CLAUDE.md`** with `test:e2e` and the packaging hook note.
- [ ] **Step 5: Commit** `test: packaging and electron e2e`

---

## Spec coverage map

| Spec § | Task |
|---|---|
| 3 Architecture / units | 1–6 |
| 4 Data model, write order, reconcile | 4 |
| 5 Gestures, limits, mic warm, errors, retry, single instance, logging | 3, 5, 6 |
| 6 Overlay window | 6 |
| 7 Dashboard, `note://`, settings, tray | 7 |
| 8 Security (sandbox, zod, CSP, media permission) | 2, 6, 7 |
| 9 Testing | 2–5 unit, 8 e2e, 6–7 manual |
