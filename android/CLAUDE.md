# CLAUDE.md

Guidance for the Android app. Not started yet: this folder will hold the Gradle project, with the app module at `android/app/`. Shared backend and repo layout: `../CLAUDE.md`.

## Plan

Native Kotlin, minimum Android 13, Samsung first, other brands after. Same Supabase backend as desktop. Sold through Google Play.

- **In scope**: voice notes, Pixie list commands, calendar events, sync, one-press link capture.
- **Dropped**: floating pill, Pomodoro, dictation paste, always-on wake word.

## Triggers

- Side button double-press (assigned in Samsung settings to open the app) captures in a supported app and starts voice everywhere else, including home and lock screens. Long-press stays with Gemini.
- After a voice clip, the first words decide: "calendar …" adds an event, "Pixie …" adds to a list, anything else stays a voice note.

## Capture

- Supported apps only: Reddit, Instagram, YouTube, YouTube Music, Spotify, X. Limit the Accessibility service to these packages.
- One-press capture is an optional setting, off by default, with Play's in-app disclosure and consent. The Accessibility service taps the app's Share then Copy link; the app reads the clipboard while focused. Normal Share with instant save is the fallback and needs no setup.
- Reddit: on a comments screen, replies are outlined for about 3 s. Tap one to save just it, circle to save part of the screen, or do nothing to save the post's link.

## Unproven until the first test on a real phone

- Recording started from a locked phone.
- Reliability and on-screen flicker of the Share then Copy link taps.
- Whether Reddit exposes each reply as its own block.
- Google Play's acceptance of the Accessibility use.
- A legal check of the Reddit, X, Spotify, Instagram and YouTube terms before selling this capture.
