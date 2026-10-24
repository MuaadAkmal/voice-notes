# Voice Notes v1: shadcn/ui, Dark Mode, System Audio Addendum

Date: 2026-10-24
Status: Design approved in conversation; pending written-spec review
Extends: `2026-10-24-voice-notes-desktop-v1-design.md` and `2026-10-24-voice-notes-folders-design.md` (their constraints still apply)

## 1. Intent

- **Robust controls**: the dashboard's hand-built toggles, menus, `confirm()` dialogs, `<select>` and toast are replaced by shadcn/ui (Radix underneath) for correct keyboard, focus and screen-reader behaviour. The toggle-overflow bug showed the cost of hand-built controls.
- **Dark mode** that follows Windows by default with a manual override.
- **System audio capture**: record what the PC is playing (the film's line) instead of, or mixed with, the mic.

Out of scope for this round (pinned for later): rewind-last-10s buffer, auto-pause media, practice playback, shadowing, Anki export.

## 2. shadcn/ui

- `shadcn` CLI init for Vite + Tailwind 4, React 19; `components.json` aliases point at `src/renderer/dashboard/` (`@/components/ui`, `@/lib/utils`). Vite + tsconfig gain the `@/*` → `src/renderer/dashboard/*` alias.
- Components: `switch`, `dropdown-menu`, `context-menu`, `alert-dialog`, `select`, `sonner`, `button` (as needed by the above).
- Theme tokens (`--background`, `--foreground`, `--muted`, `--border`, `--primary`, …) in `dashboard.css` are set to the current stone palette for light, and a stone-based dark palette under `.dark`.
- Replacements:
  - Settings toggles → `Switch` (keeps `role="switch"`, `aria-checked`).
  - Mic `<select>` → `Select` ("System default" + overlay-reported devices).
  - Note ⋯ menu → `DropdownMenu` (Rename / Show in folder / Delete).
  - Folder ⋯ menu → `DropdownMenu`; folder right-click → `ContextMenu` (New subfolder / Rename / Delete).
  - `confirm()` (note delete, bulk delete, folder delete) → one reusable `ConfirmDialog` built on `AlertDialog`; same copy as today; destructive action button styled red.
  - Custom toast → `Sonner` `toast()`; `useToast()` keeps its signature so call sites don't change; 4 000 ms duration, bottom-centre.
- The overlay pill stays hand-built (no Radix in the overlay bundle).
- Existing hand-built inline inputs (folder name, note title) stay.

## 3. Dark mode

- New setting `theme: 'system' | 'light' | 'dark'`, default `'system'`.
- Main sets `nativeTheme.themeSource = settings.theme` at boot and on change. The dashboard derives dark/light from `matchMedia('(prefers-color-scheme: dark)')` (which follows `themeSource`) and toggles `document.documentElement.classList` `dark`; it listens for changes.
- Title bar overlay colours follow the effective theme via `win.setTitleBarOverlay()` on `nativeTheme` `updated`: light `{ color: '#fafaf9', symbolColor: '#44403c' }`, dark `{ color: '#0c0a09', symbolColor: '#d6d3d1' }`. The dashboard window's `backgroundColor` uses the same colour at creation.
- Settings: a 3-segment control "System / Light / Dark".
- All dashboard surfaces use theme tokens or `dark:` variants (sidebar, rows, selection, drop rings, empty states, breadcrumb, drag strip). The overlay pill is unchanged.

## 4. System audio capture

- New setting `recordingSource: 'mic' | 'system' | 'both'`, default `'mic'`. Changeable in Settings (Select) and from a tray submenu "Record from ▸ Microphone / System audio / Both" (radio items).
- Main registers `session.defaultSession.setDisplayMediaRequestHandler` that, only for the overlay's webContents, answers with the primary screen source from `desktopCapturer.getSources({ types: ['screen'] })` and `audio: 'loopback'`; any other requester is refused.
- `RecorderStart` payload gains `source`. The overlay:
  - `mic`: unchanged (`getUserMedia`, warm 30 s).
  - `system`: `getDisplayMedia({ audio: true, video: true })`, stops the video track at once, records the audio track. Not kept warm; stopped after each clip.
  - `both`: mixes mic (gain 1.4) and system (gain 1.0) through an `AudioContext` into a `MediaStreamDestination` that feeds the same `MediaRecorder`. If system capture fails, records mic only and reports a warning.
  - Waveform analyser taps the stream actually being recorded.
- Errors: system capture failure in `system` mode → existing capture-error path with message `System audio unavailable`. In `both` mode → recording proceeds mic-only; after save the pill shows `Saved ✓ (mic only)` instead of `Saved ✓`.
- Notes gain `source: 'mic' | 'system' | 'both'` (migration #3: `ALTER TABLE notes ADD COLUMN source TEXT NOT NULL DEFAULT 'mic'`). `AudioPayload` gains `source` (the source actually recorded, so a `both`→mic fallback is stored as `mic`). The dashboard shows a small speaker icon on rows whose source includes system audio; the pill shows a mic / speaker / mic+speaker glyph while recording.
- Known limitations (documented in Settings hint): captures everything the PC plays; works with headphones; DRM-protected playback (e.g. Netflix in Chrome/Edge) may record silence.

## 5. Testing

- Unit: settings defaults/validation for `theme` and `recordingSource`; migration #3 (existing notes get `source 'mic'`); `NoteStore.create` stores `source`; controller forwards `source` to the overlay start and keeps the payload's `source`.
- E2E: update existing specs for `AlertDialog` (replace `page.once('dialog')`) and Radix menus; theme switch toggles `html.dark` and title bar request; system-source recording produces a note with `source 'system'` (Chromium loopback in the test env may be silent; assert the file exists and the row's source); screenshots of dark Inbox, Settings, menus.
- Manual: loopback recording while YouTube plays (non-silent, checked with ffmpeg volumedetect); one Netflix attempt, result reported.
