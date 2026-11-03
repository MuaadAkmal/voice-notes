@AGENTS.md

# CLAUDE.md

Guidance for the web app. Run every command from `webapp/`.

## What this is

**Voice Notes on the web** at `https://app.voicenote.cloud`: sign in with the same Google account as the desktop app, read every note and page, and make quick edits (page text, new pages, rename/star/move/delete, folders, transcripts, task ticks) that reach the PCs through the existing sync. No recording, Home widgets, reminders, calendar or settings. Spec: `docs/superpowers/specs/2026-11-03-web-app-design.md`.

**Static only, all data through `sync`.** `output: 'export'` builds plain files for Cloudflare Pages (project `voicenote-app`). Everything runs in the browser and talks only to the `sync` Edge Function (`pull`, `push`, `files/download`) with the user's token and the publishable key; the server keeps every rule (versions, conflict copies, replayed appends and ticks, delete wins). Never add a database client, Prisma, API routes or server code.

## Commands

- `npm run dev`: local app at `http://localhost:3000` (the `sync` function allows this origin)
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest)
- `npm run build`: builds to `out/`, then `scripts/csp.mjs` writes the inline-script hashes into `out/_headers` (the CSP)

## Rules

- Wire types come **type-only** from the desktop through `@wire/*` (`../desktop/src/shared/*`); runtime imports from `desktop/` only in `tests/`.
- Page bodies are sent exactly as typed: never reformat markdown (that's why the editor is CodeMirror, not a WYSIWYG editor).
- `clientId` lives in `localStorage` `vn.clientId`; `deviceName` is `Web · <Browser>`, the name conflict copies get.
- Markdown renders without raw HTML; links pass `safeUrl` (`http:`, `https:`, `mailto:`, `vn-image:` only).
- shadcn/ui components live in `src/components/ui/`; after `npx shadcn@latest add`, check imports use `@/lib/utils` (the CLI writes `from "cn"`).

## Where things are

- `src/lib/config.ts`: Supabase URL, publishable key, `SYNC_URL`. Nothing else repeats them.
- `public/_headers`: CSP and security headers for Cloudflare Pages (`{{SCRIPT_HASHES}}` filled at build).
