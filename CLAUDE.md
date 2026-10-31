# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Voice Notes**: voice notes and markdown pages that stay in step between devices. One repo, two apps on one Supabase backend. Start Claude from this root, so the shared skills and project memory load; each app's detailed notes load from its own `CLAUDE.md`.

## Layout

- `desktop/`: the Windows Electron app. Details and commands: `desktop/CLAUDE.md`. Run its commands from `desktop/`.
- `android/`: the Android app, native Kotlin, not started yet. Details: `android/CLAUDE.md`.
- `supabase/`: the backend both apps use: `functions/` (`sync`, `connectors`, `commands`, `asr`) and `migrations/`. Each function's `_shared/` is GENERATED from `desktop/src/shared` by `npm run sync:function` (run in `desktop/`) and checked by `desktop/tests/unit/sync/function-files.test.ts`; never edit it.
- `docs/`: design notes; `docs/superpowers/` (specs and plans) is local and not published.

## Across the apps

- The apps share no code: Kotlin can't import the TypeScript. They share the backend's HTTP contracts, whose wire types live in `desktop/src/shared/<function>/protocol.ts` and `desktop/src/shared/sync/protocol.ts`.
- A backend change affects both apps, and installed copies of each keep running old versions, so keep function changes backward compatible.
- A new synced setting needs the `sync` function redeployed first, because it refuses unknown keys.
- Tag releases per app: `desktop-v3.0.1`, `android-v0.1.0`.

## Contents

- `.claude/skills/find-skills/`: project-level agent skill (from `vercel-labs/skills`) for discovering and installing other skills.
- `.agents/skills/supabase/`, `.agents/skills/supabase-postgres-best-practices/`: official Supabase skills (`supabase/agent-skills`), linked into `.claude/skills/` by `npx skills add` (`.claude/` is gitignored, so on a fresh clone re-run `npx skills add supabase/agent-skills@<name> -y`).
- `skills-lock.json`: pins installed skills by source and `computedHash`. Keep it in sync when skills are added, updated, or removed. Don't hand-edit the hash.
