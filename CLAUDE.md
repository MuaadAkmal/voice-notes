# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Voice Notes**: a Windows Electron app. A global hotkey (default Ctrl+Win) shows a floating pill that records a voice note to a local `.webm` file indexed in SQLite. A dashboard plays, renames and deletes notes. Spec: `docs/superpowers/specs/2026-10-24-voice-notes-desktop-v1-design.md`; plan: `docs/superpowers/plans/2026-10-24-voice-notes-desktop-v1.md`.

## Commands

- `npm start`: run in dev (Electron Forge + Vite, HMR for renderers)
- `npm test`: Vitest unit tests. Runs **under Electron as Node** (`ELECTRON_RUN_AS_NODE=1`) because `better-sqlite3`/`uiohook-napi` are rebuilt for Electron's ABI by `postinstall`. Never run vitest with plain `node`/`npx vitest`. Filter: `npm test -- gesture`.
- `npm run typecheck`: `tsc --noEmit`
- `npm run package` / `npm run make`: packaged app / Squirrel installer in `out/`
- `npm run test:e2e`: packages, then Playwright `_electron` tests in `tests/e2e/`

## Architecture

- `src/main/`: Electron main. Pure, unit-tested core (`hotkey/gesture.ts`, `recorder/controller.ts`, `store/note-store.ts`, `settings.ts`) plus thin Electron adapters (`hotkey/service.ts` uiohook, `windows.ts`, `ipc.ts`, `protocol.ts`, `tray.ts`). `index.ts` wires them.
- `src/preload/`: one sandboxed preload per renderer (`overlay.ts`, `dashboard.ts`), built to `.vite/build/<name>.cjs`.
- `src/renderer/overlay/`: the floating pill; owns mic capture (`MediaRecorder`).
- `src/renderer/dashboard/`: notes list and settings.
- `src/shared/`: IPC channel names, payload types and zod schemas (`ipc.ts`), plus pure formatting helpers.
- Vite configs are `.mts` (Forge 8). Renderer roots are `src/renderer/<name>`; CSP is injected at build time only (`vite.csp.mts`).

## Data

`%APPDATA%/Voice Notes/`: `recordings/<uuid>.webm`, `voice-notes.sqlite`, `settings.json`, `logs/`. Override with env `VOICE_NOTES_USER_DATA` (used by e2e). `VOICE_NOTES_TEST=1` exposes `globalThis.__voiceNotes` in main for Playwright.

## Contents

- `.claude/skills/find-skills/`: project-level agent skill (from `vercel-labs/skills`) for discovering and installing other skills.
- `skills-lock.json`: pins installed skills by source and `computedHash`. Keep it in sync when skills are added, updated, or removed. Don't hand-edit the hash.
