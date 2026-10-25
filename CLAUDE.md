# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Voice Notes**: a Windows Electron app. A global hotkey (default Alt+Win) shows a floating pill that records a voice note to a local `.webm` file indexed in SQLite. A dashboard organises notes into nested folders (Inbox = unfiled), and plays, renames, moves (drag & drop, multi-select) and deletes them. Specs: `docs/superpowers/specs/` (v1 design + folders addendum); plans: `docs/superpowers/plans/`.

## Commands

- `npm start`: run in dev (Electron Forge + Vite, HMR for renderers)
- `npm test`: Vitest unit tests. Runs **under Electron as Node** (`ELECTRON_RUN_AS_NODE=1`) because `better-sqlite3`/`uiohook-napi` are rebuilt for Electron's ABI by `postinstall`. Never run vitest with plain `node`/`npx vitest`. Filter: `npm test -- gesture`.
- `npm run typecheck`: `tsc --noEmit`
- `npm run package` / `npm run make`: packaged app / Squirrel installer in `out/`
- `npm run test:e2e`: runs `package` (emits the production Vite build to `.vite/`), then Playwright `_electron` tests in `tests/e2e/` (shared launcher `tests/e2e/launch.ts`; screenshots to `.superpowers/shots/`). Stop any running `npm start` first: its watcher rewrites `.vite/` with dev-server URLs. Close the packaged app before packaging (it locks `out/`). The launcher sets `colorScheme: null` so Playwright doesn't force light mode. They launch `electron .` with the dev binary, not the packaged exe, because packaged fuses disable the Node inspector Playwright needs.
- Packaging: Vite bundles everything except `better-sqlite3`/`uiohook-napi`; `forge.config.mts` `packageAfterCopy` copies them (plus `node-gyp-build`) into the package. Add any new native module there and to `vite.main.config.mts` externals.

## Architecture

- `src/main/`: Electron main. Pure, unit-tested core (`hotkey/gesture.ts`, `recorder/controller.ts`, `store/note-store.ts`, `store/folder-store.ts`, `settings.ts`) plus thin Electron adapters (`hotkey/service.ts` uiohook, `windows.ts`, `ipc.ts`, `protocol.ts`, `tray.ts`). `index.ts` wires them.
- `src/preload/`: one sandboxed preload per renderer (`overlay.ts`, `dashboard.ts`), built to `.vite/build/<name>.cjs`.
- `src/renderer/overlay/`: the floating pill; owns capture (`useRecorder.ts`: mic via getUserMedia, system audio via getDisplayMedia answered by main's `setDisplayMediaRequestHandler` with `audio: 'loopback'`, or a WebAudio mix for "both"). Hand-built on purpose: no shadcn/Radix/lucide in the overlay bundle. `Pill.tsx`: canvas loudness waveform (`src/shared/audio-level.ts`), "No sound" after 3 s of silence, hands-free lock + discard ×, "Saved ✓ · Add title" (main makes the overlay focusable only while the title input is open). `useDrag.ts`: drag past 4 px moves the window (`overlay:drag`), position saved as `pillPosition` and resolved by `src/main/overlay-position.ts`.
- `src/renderer/dashboard/`: `App.tsx` owns the `View` (`inbox | all | folder | settings`) and loads notes + folders; `Sidebar.tsx` (folder tree, inline create/rename, drop targets), `NotesPage.tsx` (filtered list, selection, drag source), `dnd.ts` (current drag payload, since dataTransfer is unreadable during dragover), `Toast.tsx` (Sonner), `ConfirmDialog.tsx` (`useConfirm`). shadcn/ui components live in `src/renderer/dashboard/components/ui/` (`@/` alias → `src/renderer/dashboard/`); add more with `npx shadcn@latest add <name>`, then check imports use `@/lib/utils` (the CLI once rewrote it to an npm package `cn`).
- Theme: settings `theme` → `nativeTheme.themeSource` (main) → `prefers-color-scheme` → `html.dark` (dashboard `main.tsx`); caption buttons recoloured by `applyTitleBarTheme`. Colours are shadcn tokens in `dashboard.css`; use tokens, not raw stone-* classes.
- `src/shared/`: IPC channel names, payload types and zod schemas (`ipc.ts`), plus pure helpers: `format.ts`, `folders.ts` (tree, path, cycle check, range selection).
- Vite configs are `.mts` (Forge 8). Renderer roots are `src/renderer/<name>`; CSP is injected at build time only (`vite.csp.mts`).

## Data

`%APPDATA%/Voice Notes/`: `recordings/<uuid>.webm`, `voice-notes.sqlite`, `settings.json`, `logs/`. Folders are database rows only (migration #2); notes carry `source` mic/system/both (migration #3); audio files never move. Override the data dir with env `VOICE_NOTES_USER_DATA` (used by e2e). `VOICE_NOTES_TEST=1` exposes `globalThis.__voiceNotes` in main for Playwright and skips the global keyboard hook (so a person typing during a test run can't interfere). `launch({ fakeAudioFile })` feeds a WAV to the fake mic, e.g. `tests/e2e/fixtures/silence.wav`.

## Contents

- `.claude/skills/find-skills/`: project-level agent skill (from `vercel-labs/skills`) for discovering and installing other skills.
- `skills-lock.json`: pins installed skills by source and `computedHash`. Keep it in sync when skills are added, updated, or removed. Don't hand-edit the hash.
