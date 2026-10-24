# Voice Notes shadcn/ui, Dark Mode, System Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's hand-built controls with shadcn/ui, add System/Light/Dark theming, and let recordings capture system audio (mic / system / both).

**Architecture:** shadcn components live in `src/renderer/dashboard/components/ui/` behind an `@/` alias; theme tokens in `dashboard.css`. Theme flows settings → `nativeTheme.themeSource` → `prefers-color-scheme` → `html.dark`, plus title bar overlay recolouring. System audio uses Electron's `setDisplayMediaRequestHandler` with `audio: 'loopback'`; the overlay builds the recording stream per source (mic, loopback, or a WebAudio mix) and reports the source actually recorded.

**Tech Stack:** existing stack + shadcn/ui (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`).

**Spec:** `docs/superpowers/specs/2026-10-24-voice-notes-ui-theme-system-audio-design.md`

## Global Constraints

- All earlier constraints hold (sandboxed renderers, zod-validated IPC, append-only migrations, Electron-as-Node unit tests, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Stop any `npm start` before `npm run test:e2e`; close the packaged app before packaging (it locks `out/`).
- Settings additions: `theme: 'system' | 'light' | 'dark'` default `'system'`; `recordingSource: 'mic' | 'system' | 'both'` default `'mic'`.
- Title bar overlay colours: light `#fafaf9` / `#44403c`; dark `#0c0a09` / `#d6d3d1`.
- Mix gains: mic 1.4, system 1.0. Messages: `System audio unavailable`, `Saved ✓ (mic only)`.
- Toast: 4 000 ms, bottom-centre. Confirm copy unchanged from the folders spec.
- The overlay bundle must not import Radix/shadcn.

## Review Focus

1. **Theme set to System while Windows switches light↔dark at runtime** → dashboard and caption buttons follow without restart → Task 3 (main listens to `nativeTheme` `updated`; e2e asserts `setTitleBarOverlay` call path via `html.dark` + manual check).
2. **`both` mode when loopback fails** → mic-only clip saved with `source 'mic'` and the `(mic only)` flash, never a lost recording → Task 5 (controller test `saved flash notes a mic-only fallback`).
3. **Existing notes after migration #3** → `source 'mic'` → Task 4 (`migrates a v2 database`).
4. **A non-overlay page asking for display media** (e.g. a navigated dashboard) → refused → Task 5 (handler checks requester webContents; reviewed).
5. **Radix dialogs/menus inside the `.app-drag` strip or over the native caption buttons** → portals render in `body`, never in the drag region; dialogs remain clickable → Task 2 manual/e2e screenshot.

---

### Task 1: shadcn setup + Settings controls + Sonner

**Files:** `components.json`, `tsconfig.json` (paths), `vite.dashboard.config.mts` (alias), `src/renderer/dashboard/lib/utils.ts`, `src/renderer/dashboard/components/ui/{switch,select,sonner,button}.tsx`, `dashboard.css` (tokens), `SettingsPage.tsx`, `Toast.tsx`, `tests/e2e/settings.spec.ts`

**Interfaces:** Produces `cn(...classes)`, shadcn `Switch`, `Select*`, `Toaster`; `useToast()` keeps `(message: string) => void`.

- [ ] Step 1: run `npx shadcn@latest init` (Vite, base colour stone, CSS variables) then `npx shadcn@latest add switch select sonner button`; fix generated imports to the `@/` alias; keep existing `.app-drag` and scrollbar CSS.
- [ ] Step 2: replace `Toggle` with `Switch`, mic `<select>` with `Select` (value `''` ↔ `null` mapped as `'default'` since Radix Select disallows empty values), toast with `Toaster` + `toast()`.
- [ ] Step 3: update `settings.spec.ts` to measure the Radix switch thumb (`[data-slot="switch-thumb"]` or the child span) — same in-track assertions; run `npm run test:e2e` → all pass; `npx tsc --noEmit` clean; `npm test` pass.
- [ ] Step 4: commit `feat: shadcn/ui setup, settings switches, select and sonner`.

### Task 2: Menus and confirm dialogs

**Files:** `components/ui/{dropdown-menu,context-menu,alert-dialog}.tsx`, new `src/renderer/dashboard/ConfirmDialog.tsx`, `Sidebar.tsx`, `NoteRow.tsx`, `NotesPage.tsx`, e2e specs

**Interfaces:** Produces `useConfirm(): (opts: { title: string; description?: string; confirmLabel?: string }) => Promise<boolean>` (provider renders one `AlertDialog`; destructive button).

- [ ] Step 1: add the three components; implement `ConfirmProvider`/`useConfirm`, mount in `App`.
- [ ] Step 2: note ⋯ → `DropdownMenu`; folder ⋯ → `DropdownMenu`; folder row wrapped in `ContextMenu` with the same items; remove hand-rolled menu state/listeners.
- [ ] Step 3: replace every `confirm()` with `await confirm({...})` (note delete `Delete this note?`, bulk `Delete <n> notes?`, folder per spec copy).
- [ ] Step 4: update e2e: replace `page.once('dialog')` with clicking the dialog's `Delete` button (`getByRole('alertdialog').getByRole('button', { name: 'Delete' })`); menu items via `getByRole('menuitem', …)`. Run all e2e → pass. Screenshot a menu + dialog to `.superpowers/shots/ui-*.png`.
- [ ] Step 5: commit `feat: radix menus and confirm dialog`.

### Task 3: Dark mode

**Files:** `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/main/settings.ts`, `src/main/windows.ts`, `src/main/index.ts`, `dashboard.css`, `src/renderer/dashboard/{main.tsx,App.tsx,Sidebar.tsx,NotesPage.tsx,NoteRow.tsx,SettingsPage.tsx}`, `tests/unit/settings.test.ts`, `tests/e2e/theme.spec.ts`

**Interfaces:** Produces `Settings.theme`; `applyTitleBarTheme(win: BrowserWindow): void` in `windows.ts`; renderer hook `useThemeClass()` in `main.tsx`.

- [ ] Step 1 (RED): settings tests — default `theme: 'system'`; invalid `"theme":"blue"` → `'system'`. Run → FAIL.
- [ ] Step 2: add field + zod enum; GREEN.
- [ ] Step 3: main sets `nativeTheme.themeSource` at boot and in `updateSettings`; `nativeTheme.on('updated')` → `applyTitleBarTheme(dashboard)`; window `backgroundColor` from `nativeTheme.shouldUseDarkColors`.
- [ ] Step 4: renderer toggles `html.dark` from `matchMedia`; add `.dark` token values; sweep components for hard-coded stone colours → tokens/`dark:` variants; Settings gets a 3-segment control (buttons with `aria-pressed`).
- [ ] Step 5: e2e `theme.spec.ts`: select Dark → `html` has class `dark`; Light → not; screenshots of dark Inbox/Settings/menu. Run all → pass.
- [ ] Step 6: commit `feat: dark mode with system/light/dark setting`.

### Task 4: Recording source setting + migration #3

**Files:** `channels.ts`, `ipc.ts`, `settings.ts`, `store/migrations.ts`, `store/schema.ts`, `store/note-store.ts`, `recorder/controller.ts`, `tests/unit/{settings,note-store,controller}.test.ts`

**Interfaces:** Produces `RecordingSource = 'mic' | 'system' | 'both'`; `Settings.recordingSource`; `Note.source: 'mic' | 'system' | 'both'`; `NewAudio.source`; `AudioPayload.source`; `OverlayPort.start(deviceId, source)`; controller opt `getSource(): RecordingSource`; `OverlayState` `saved` gains optional `micOnly?: true`.

- [ ] Step 1 (RED): tests — settings default `'mic'` and invalid fallback; `migrates a v2 database` (notes get `source 'mic'`); `create stores source`; controller `start passes source to the overlay`; `saved flash notes a mic-only fallback` (start with source `both`, audio arrives with source `mic` → state `{ kind: 'saved', micOnly: true }`).
- [ ] Step 2: implement; migration #3 SQL per spec; GREEN; `npx tsc --noEmit` clean (update fixtures with `source`).
- [ ] Step 3: commit `feat: recording source setting and note source column`.

### Task 5: System audio capture end to end

**Files:** `src/main/index.ts` (display media handler, tray submenu, start payload), `src/main/tray.ts`, `src/main/ipc.ts` (payload schema), `src/preload/overlay.ts`, `src/renderer/overlay/{useRecorder.ts,Pill.tsx}`, `SettingsPage.tsx` (Select + hint), `NoteRow.tsx` (speaker icon), `tests/e2e/record.spec.ts`

**Interfaces:** Consumes Task 4. `createTray` actions gain `getSource(): RecordingSource; setSource(s): void`.

- [ ] Step 1: main: `setDisplayMediaRequestHandler((req, cb) => …)` — if `req.frame` belongs to the overlay webContents, `desktopCapturer.getSources({ types: ['screen'] })` → `cb({ video: sources[0], audio: 'loopback' })`, else `cb({})`. Tray radio submenu. `RecorderStart` sends `{ deviceId, source }`.
- [ ] Step 2: overlay `useRecorder`: build stream per spec (`mic` unchanged; `system` via `getDisplayMedia`, video track stopped, released after clip; `both` mixed via `AudioContext` gains, fallback to mic with `recordedSource = 'mic'`); `sendAudio` includes `source`; system failure in `system` mode → `sendError('System audio unavailable')`.
- [ ] Step 3: Pill shows source glyph while recording and `Saved ✓ (mic only)` when `micOnly`; Settings `Select` "Record from" + limitation hint; NoteRow speaker icon for `system`/`both`.
- [ ] Step 4: e2e `records system audio` — set source via `dashboardApi.setSettings({ recordingSource: 'system' })` in the page, record, assert note `source === 'system'` and file size > 0. Run all → pass.
- [ ] Step 5: manual — play a YouTube video, record with source System from the packaged app, `ffmpeg -af volumedetect` shows non-silent mean volume; try Netflix in Edge/Chrome and record the outcome in the ledger.
- [ ] Step 6: update `CLAUDE.md` (shadcn location, theme flow, system audio); commit `feat: system audio capture (mic / system / both)`.

## Spec coverage map

| Spec § | Task |
|---|---|
| 2 shadcn/ui | 1, 2 |
| 3 Dark mode | 3 |
| 4 System audio (setting, migration, capture, errors, UI) | 4, 5 |
| 5 Testing | 1–5 |
