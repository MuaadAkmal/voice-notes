@AGENTS.md

# CLAUDE.md

Guidance for the web app. Run every command from `webapp/`.

## What this is

**Voice Notes on the web** at `https://app.voicenote.cloud`: sign in with the same Google account as the desktop app, read every note and page, and make quick edits (page text, new pages, rename/star/move/delete, folders, transcripts, task ticks) that reach the PCs through the existing sync. No recording, Home widgets, reminders, calendar or settings. Spec: `docs/superpowers/specs/2026-11-03-web-app-design.md`.

**Static only, all data through `sync`.** `output: 'export'` builds plain files, served by Cloudflare as the static-assets Worker `voicenote-app` (`wrangler.jsonc`, custom domain `app.voicenote.cloud`). Everything runs in the browser and talks only to the `sync` Edge Function (`pull`, `push`, `files/download`) with the user's token and the publishable key; the server keeps every rule (versions, conflict copies, replayed appends and ticks, delete wins). Never add a database client, Prisma, API routes or server code.

## Commands

- `npm run dev`: local app at `http://localhost:3000` (the `sync` function allows this origin)
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest)
- `npm run build`: builds to `out/`, then `scripts/csp.mjs` writes the inline-script hashes into `out/_headers` (the CSP)
- `npm run deploy`: build, then `wrangler deploy` (needs `wrangler login`). Never run `wrangler pages project create` here: its auto-setup rewrites the project for OpenNext.

## Rules

- Wire types come **type-only** from the desktop through `@wire/*` (`../desktop/src/shared/*`); runtime imports from `desktop/` only in `tests/`.
- Page bodies are sent exactly as typed: never reformat markdown (that's why the editor is CodeMirror, not a WYSIWYG editor).
- `clientId` lives in `localStorage` `vn.clientId`; `deviceName` is `Web · <Browser>`, the name conflict copies get.
- Markdown renders without raw HTML; links pass `safeUrl` (`http:`, `https:`, `mailto:`, `vn-image:` only).
- shadcn/ui components live in `src/components/ui/`; after `npx shadcn@latest add`, check imports use `@/lib/utils` (the CLI writes `from "cn"`).

## Where things are

- `src/lib/config.ts`: Supabase URL, publishable key, `SYNC_URL`. Nothing else repeats them.
- `public/_headers`: CSP and security headers, applied by Cloudflare static assets (`{{SCRIPT_HASHES}}` filled at build).
- `src/sync/`: `client.ts` (`SyncClient`: `pull`/`push`/`download`, typed errors `NotSignedIn`/`Offline`/`AuthExpired`/`Rejected`/`ServerError`), `store.ts` (`WebStore`: rows + versions, unacked edits laid back over each pull, `useSyncExternalStore` snapshot), `outbox.ts` (`Outbox`: one queued body per page, never merged into one in flight), `engine.ts` (`SyncEngine`: push then pull; 1 s after an edit, every 5 min, on focus and on another device's ping; backoff 30 s → 10 min; refresh once on 401, then `onSignedOut` with the unsaved bodies).
- `src/app/providers.tsx`: `SyncProvider` (engine, Realtime `sync:<user_id>` pings, `beforeunload` while unsaved), `useStore`, `useEngine`, `useSyncStatus`.
- `src/lib/`: `apply-op.ts` (`applyWebOp`, the desktop's `applyOp` for the web's ops; parity-tested), `task-lines.ts`, `search.ts`, `markdown-url.ts` (`safeUrl`), `device.ts`, `tree.ts` (sidebar tree, list views, folder paths, `Route`), `actions.ts` (create/rename/star/move/delete; built-in pages can't be deleted), `unsaved.ts` (`vn.unsaved` in `sessionStorage`), `supabase.ts`.
- `src/components/shell/`: `AppShell` (sidebar or phone sheet, the centred column, ⌘K), `Sidebar`, `FileTree` (drag and drop), `ItemMenu` (⋯), `MoveDialog`, `CommandPalette`, `StatusLine`, `RestoreUnsaved`. `src/components/page/`: `PageView`, `Markdown` (react-markdown + remark-gfm; task boxes tick by source line), `PageEditor` (CodeMirror, seeded once, saves 1 s after typing), `TitleField`. `src/components/note/`: `NoteView` (audio fetched on Play), `TranscriptField`.
- `src/hooks/`: `useSession`, `useRoute` (query-string routes), `useSignedUrl` (audio and page images, reused for 60 s).
