# v3 features

Picked on 2026-10-26. These are ideas only and nothing is designed yet. Each one goes through brainstorm, spec and plan before it is built.

- [ ] **Trim clips**
- [ ] **First-run onboarding**
- [ ] **Calendar sync & reminders** (pinned for the SaaS phase)
- [ ] **Anki export** (pinned)
- [ ] **Voice to calendar** (picked 2026-10-29)
- [ ] **Dictation cleanup** (picked 2026-10-29)
- [ ] **Quick capture** (picked 2026-10-29)
- [ ] **Remind me on Review later items** (picked 2026-10-29)
- [ ] **Auto-file rules** (picked 2026-10-29)
- [ ] **Today summary** (on hold: needs a chat model provider)

Suggested build order for the 2026-10-29 picks: dictation cleanup → quick capture → voice to calendar → Review later reminders → auto-file rules. None of them needs AI or a new API key.

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

Update 2026-10-29: the Google Calendar connector, the Today's calendar card and the Calendar tab are built on `feat/connectors`, through the `connectors` Edge Function. Reminders on notes are still to do.

Parked until the SaaS web app exists, because it reuses that app's Google login: the `calendar.events` permission is added to the server-side sign-in. There is no separate desktop Google login.

- **Remind me about a note:** pick a date and time on a note or page, and the app creates a Google Calendar event that links back to it.
- **Today's calendar widget:** a Home card that lists today's events.
- **Samsung Calendar:** there is no public API. It shows the same events once the Google account is added on the phone.

## Anki export (pinned)

Turn voice notes into Anki flashcards: the audio on the front, the title or transcript on the back.

- Export a `.apkg` file (a zip holding Anki's SQLite collection plus the media files).
- Clips are converted from `.webm` to WAV, which Anki plays everywhere, using the existing WAV converter.

## How calendar reminders work

No AI needed. Every Google Calendar event can carry notifications. Without any, it uses the calendar's default (usually a popup 10 min before, set in Google Calendar → Settings). The Google Calendar app on the phone, or Chrome with notifications allowed, shows the alert, so Voice Notes doesn't have to be running. A custom time is a plain field on create/patch: `reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }`, covered by the `calendar.events` scope we already have. Quick Add can't set it, but the event can be patched right after.

## Voice to calendar

Say "Calendar, meeting with Alex tomorrow 5 pm" on the dictation hotkey, and an event is created instead of the text being pasted. Uses the existing Whisper setup and `quickAdd`. A trigger word is used rather than a new hotkey, because Ctrl+Win+Shift would fight the Ctrl+Win gesture. Limits: Alex gets no invite (the name is just in the title), no custom duration or alert time, best with English phrasing. Structured extraction with a chat model can come later if those limits matter.

```
Add "voice to calendar" to dictation.

When a dictation transcript starts with a calendar trigger, create a Google Calendar
event via the existing ConnectorsService.quickAdd instead of pasting.

- Triggers (case-insensitive, ignore leading punctuation/commas): "calendar",
  "remind me", "schedule", "set up a meeting", "add event". Keep the list in a pure
  helper in src/shared/ (e.g. calendar-command.ts: parseCalendarCommand(text) ->
  { text } | null) with unit tests, including Whisper quirks like "Calendar." and
  "calender".
- Strip the trigger and lead-in verbs so the title is clean:
  "set up meeting with alex tomorrow 5 pm" -> "meeting with alex tomorrow 5 pm";
  "remind me to call mum at 4" -> "call mum at 4".
- In dictation/controller.ts, after transcribe: if it parses as a command, call
  quickAdd and skip paste. Still save the dictation to the panel (prefixed "📅").
- Feedback on the overlay pill: "Added · Meeting with Alex · Fri 17:00" on success.
  On failure (not signed in, calendar not connected, needs reconnect, offline),
  show a short message and fall back to pasting the text so nothing is lost.
- A setting "Voice to calendar" (on by default when the calendar is connected)
  on the Connectors page under the Google Calendar card.
- e2e: use the connectors test server; dictate "Calendar lunch tomorrow 1pm",
  assert the fake Google got a quickAdd and nothing was pasted.
- Update CLAUDE.md.
```

## Dictation cleanup

```
Improve dictation accuracy and cleanliness.
- Setting "Custom words" (list of names/jargon, local, not synced) on the
  Transcription page. Pass them as Whisper's `prompt` field in openai-client.ts
  (both server and built-in), capped to ~200 tokens. Applies to dictation and note
  transcription.
- Setting "Remove filler words" (default on, dictation only): pure helper in
  src/shared/dictation-clean.ts that removes um/uh/erm/"you know"/repeated words
  ("the the"), fixes spacing and capitalises the first letter. Never removes
  meaningful words ("like" only when surrounded by commas/pauses). Unit tests with
  many examples.
- Apply before save and paste in dictation/controller.ts.
- Update CLAUDE.md.
```

## Quick capture

```
Add a global "quick capture" text box.
- New hotkey setting (default Ctrl+Alt+Space; must differ from the other combos,
  reuse sameCombo checks). Pressing it shows a small focused input window near the
  pill (hand-built, no shadcn, like the overlay).
- Enter appends "- text" under today's heading of a chosen page using the existing
  learn-log appendEntry path (the same one Home quick-add uses, so sync records it).
  Esc closes. A dropdown/Tab cycles the target page among existing quick-add widget
  targets; remembers the last one.
- If text starts with "[] " append as "- [ ] task".
- Window closes on blur; shows "Saved ✓" briefly.
- Unit tests for parsing, e2e that the entry lands on the page.
- Update CLAUDE.md.
```

## Remind me on Review later items

```
Add "Remind me" to Review later items.
- On the Review later page and its Home card, each "- [ ] …" line gets a small
  bell action (on hover) with presets: Tonight 20:00, Tomorrow 09:00, This weekend
  (Sat 10:00), Pick date/time.
- Creates a Google Calendar event via ConnectorsService.create: title = item text
  (link title or URL shortened), description = full URL, 15-min event, reminders
  overrides popup 0 min. Extend GoogleCalendar.create to accept reminders.
- Hidden when the calendar isn't connected (show "Connect Google Calendar" hint once).
- After success, append " ⏰ Sat 10:00" to the line via the per-line edit path
  (like pages:set-task), never setPageBody.
- Toast on success/failure. Unit tests for the time presets (pure, src/shared/),
  e2e with the connectors test server.
- Update CLAUDE.md.
```

## Auto-file rules

Rules, not AI: notes already store the window title and `show` label. AI would only be needed to sort by what was said.

```
Add rule-based auto-filing for voice notes (no AI).
- Settings page section "Auto-file": list of rules { match: 'show' | 'window title',
  contains: string, folderId }. Add/edit/delete/reorder; first match wins.
  Rules are a synced setting (add to SYNCED_KEYS) and drop rules whose folder is gone.
- Pure helper src/shared/auto-file.ts: pickFolder(note, rules, folders) ->
  folderId | null; accent/case-insensitive like search.ts. Unit tests.
- Apply when a new note is saved (mic, system, rewind) and only if it would go
  to Inbox. Never moves existing notes; offer "Apply to Inbox now" button that
  runs it once over unfiled notes.
- Toast/pill text "Saved to Learning".
- Update CLAUDE.md.
```

## Today summary (on hold)

An end-of-day Home card: today's notes, dictations, open Review later items, quick-add entries and tomorrow's events. A first version can be plain grouped lists with no AI. The written summary needs a chat model provider (OpenAI-compatible `POST /chat/completions`, set up next to "My server"); cache the result per day and regenerate on ↻ or when data changes.

System prompt:

```
You write a short end-of-day summary for one person, from their own notes app data.
Rules:
- Use only the data given. Never invent events, people, tasks or decisions.
- Be brief: the whole summary fits on a small card (max ~120 words).
- Plain markdown only: one-line headline, then up to 3 short sections from:
  "Done today", "Still open", "Tomorrow". Skip a section if it has nothing.
- Open tasks stay as "- [ ] …" lines, copied word for word.
- Mention a voice note by its title (or show label if untitled), never by id.
- If there is almost nothing, say so in one friendly line. Don't pad.
- Write in the same language as most of the input.
```

User message (filled by main; cap each section at ~10 items, transcripts at ~300 chars):

```
Today is {weekday, D Mon YYYY}. Time now: {HH:mm}.

## Calendar today
{- 09:00–09:30 Standup}  (or "none")

## Calendar tomorrow
{- 10:00 Call with Alex}

## Voice notes recorded today
{- "Pricing idea" (from: Chrome – Figma) — transcript: "…first 300 chars…"}

## Dictations today
{- (Slack) "…first 150 chars…"}

## Open Review later items
{- [ ] https://… article title}

## Today's quick-add entries
{- Learn log: "useEffect cleanup runs before re-run"}
```
