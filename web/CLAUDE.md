@AGENTS.md

# CLAUDE.md

Guidance for the website. Run every command from `web/`.

## What this is

The public site at `https://voicenote.cloud`: a landing page for language learners, the Windows download, and the privacy and terms pages. It shares no code with `desktop/` or `android/`.

**Static only.** `output: 'export'` builds plain files for Cloudflare Pages, so no API routes, server actions, middleware, cookies, analytics or third-party runtime requests. Copy describes only what the app does today.

## Commands

- `npm run dev`: local site
- `npm run lint`, `npm run build`: lint, and build to `out/`
- `npm run check:download`: confirms the installer URL answers

## Where things are

- `src/lib/site.ts`: the installer URL, site URL and contact email. Nothing else repeats them.
- `src/components/HeroMedia.tsx`: the hero's screenshot or video. Set `VIDEO_URL` to switch to the video, hosted on R2 because Pages limits files to 25 MiB.
- `src/app/globals.css`: tokens and the shared glass, shadow and button styles. Off-white by default; `ThemeToggle.tsx` switches `data-theme` on `<html>` and remembers the choice in `localStorage`.
- `src/components/Reveal.tsx`: scroll reveals with Motion. Anything Motion starts hidden is shown without JavaScript by the `<noscript>` rule in `layout.tsx`.
- `src/app/privacy/page.tsx`: must change when the app starts sending data somewhere new.
