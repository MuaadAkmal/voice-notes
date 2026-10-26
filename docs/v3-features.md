# v3 features

Picked on 2026-10-26. These are ideas only and nothing is designed yet. Each one goes through brainstorm, spec and plan before it is built.

- [ ] **Trim clips**
- [ ] **First-run onboarding**
- [ ] **Calendar sync & reminders** (pinned for the SaaS phase)
- [ ] **Anki export** (pinned)

## Trim clips

Cut silence or extra audio from the start or end of a voice note.

- Open question: either re-encode a new `.webm` (a real edit, which saves space) or store `trim_start` / `trim_end` on the note and skip that part on playback. The second keeps the original audio, so the edit can be undone.
- Transcription and Anki export would need to respect the trim.

## First-run onboarding

A short first-launch flow, mainly for when the app becomes a SaaS:

1. Press the hotkey (Alt+Win) to test it, and see the pill appear.
2. Mic check with a live level meter, and the option to pick another mic.
3. A card explaining film mode and the rewind hotkey (Alt+Win+Shift).

It can be skipped and reopened from Settings.

## Calendar sync & reminders (pinned for the SaaS phase)

Parked until the SaaS web app exists, because it reuses that app's Google login: the `calendar.events` permission is added to the server-side sign-in. There is no separate desktop Google login.

- **Remind me about a note:** pick a date and time on a note or page, and the app creates a Google Calendar event that links back to it.
- **Today's calendar widget:** a Home card that lists today's events.
- **Samsung Calendar:** there is no public API. It shows the same events once the Google account is added on the phone.

## Anki export (pinned)

Turn voice notes into Anki flashcards: the audio on the front, the title or transcript on the back.

- Export a `.apkg` file (a zip holding Anki's SQLite collection plus the media files).
- Clips are converted from `.webm` to WAV, which Anki plays everywhere, using the existing WAV converter.
