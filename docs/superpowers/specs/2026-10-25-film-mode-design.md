# Film mode: rewind, auto-pause, context, search (design)

Round 5 of v1. Branch `feat/film-mode` (tag `before-film-mode` marks the state before it).
User picked: #1 rewind buffer, #2 auto-pause media, #3 context capture (title only, no screenshot), #12 search & filters.

## Decisions (from the user)

- **Film mode** is an explicit toggle (tray checkbox, Settings switch). Off by default and **reset to off at every launch**, so the app never silently listens after a reboot. While on, the idle pill shows a sky-blue dot.
- **Rewind**: `Alt+Win+Shift` (fixed) saves the last N seconds of system audio, N ∈ {10, 15, 30, 60}, default 15 (Settings). Only works in film mode; otherwise the pill says "Turn on film mode to rewind".
- **Auto-pause**: for **mic-only** notes, if sound is actually playing, press the Windows play/pause media key at start and again when capture ends. Setting, default on. Never for system/both (the clip would be silent). Never under `VOICE_NOTES_TEST=1`.
- **Context**: every note stores the foreground window title (raw) and a cleaned **show** label ("La Casa de Papel | Netflix - Google Chrome" → "La Casa de Papel"), editable per note. No screenshots.
- **Search**: a search bar (title, show, window title; case- and accent-insensitive) plus filters: Show dropdown, Source (mic / system / both / rewind), ★ Starred. Any active query/filter searches all notes, with folder labels. Sidebar gains ★ Starred.

## Technical choices (approved)

1. Rewind buffer: raw PCM ring buffer (mono, 60 s max) in the overlay, fed by an AudioWorklet on a loopback stream; on save the last N s are encoded to Opus/WebM with **mediabunny** (WebCodecs; successor of the deprecated webm-muxer). Output is a normal `.webm` note.
2. **koffi** (FFI, prebuilt for Electron) calls `user32`/`kernel32`: foreground window title + process name, and `keybd_event(VK_MEDIA_PLAY_PAUSE)`.
3. "Is sound playing?": the overlay measures loopback loudness (the live film buffer if on, else a ~300 ms probe). Playing = any 50 ms window above −50 dB (`isSilent` threshold).

## Data

Migration #4 (append-only):

```sql
ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'rewind'));
ALTER TABLE notes ADD COLUMN window_title TEXT;
ALTER TABLE notes ADD COLUMN show TEXT;
ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
CREATE INDEX notes_show ON notes (show);
```

`Note` gains `kind`, `windowTitle`, `show`, `starred`. Rewind notes have `source: 'system'`, `kind: 'rewind'`.
Settings gain `filmMode` (forced false at boot), `rewindSeconds` (10|15|30|60), `autoPause` (true).

## Units

| Unit | Kind | Purpose |
|---|---|---|
| `shared/show.ts` `showFromTitle(title, process)` | pure | strip browser/site/player suffixes, notification counts, file extensions → label or null |
| `shared/search.ts` `filterNotes`, `distinctShows`, `normalize` | pure | the dashboard query |
| `shared/ring-buffer.ts` `RingBuffer` | pure | fixed-capacity Float32 ring: `push`, `latest(n)`, `size` |
| `main/media/auto-pause.ts` `AutoPause` | pure | probe → press → resume, with a token so a capture that ended before the probe answers never pauses |
| `main/win32.ts` | adapter | koffi bindings: `foregroundWindow()`, `pressPlayPause()` |
| `main/recorder/controller.ts` | extend | `rewind()` + `'rewinding'` state; `getContext` at start/rewind; `onCaptureStart/End` hooks; context and kind passed to the sink |
| `main/hotkey/service.ts` | extend | second combo (rewind) checked before the main one; if the main combo's hold already started, it is cancelled; injected media keys ignored |
| `renderer/overlay/useFilmBuffer.ts` + `ring-worklet.js` | renderer | loopback → worklet → ring; `save(seconds)` → mediabunny; `probe()` |
| dashboard | UI | search bar + filters, Starred view, star toggle, show chip with inline edit, rewind badge, Settings rows, tray item |

## Flows

- **Rewind**: hotkey → main `onRewind` → not film mode: error flash; controller not idle: ignored → `controller.rewind()` captures context, sets `'rewinding'`, overlay shows "Saving last 15 s…", sends `film:save {seconds}` → overlay encodes and sends `recorder:audio` with `kind: 'rewind'` → saved flash with "Add title". Watchdog 5 s. Empty buffer → "Nothing to rewind yet".
- **Auto-pause**: controller `onCaptureStart(source)` → `AutoPause.start` (only mic, setting on) → probe via overlay (`media:probe` / `media:probe-result`, 1 s timeout = not playing) → press. `onCaptureEnd` (stop, cancel, error, recorder ended itself) → press again iff we paused.
- **Film mode on/off**: main sends `film:mode {on}` to the overlay (also on every overlay load). Loopback failure or track end → overlay sends `film:error`, main turns film mode off and flashes "Film mode stopped".

## Error handling

All new IPC payloads zod-validated with sender checks. koffi load failure → context null and auto-pause disabled (logged), never a crash. The worklet ring is capped at 60 s × sampleRate floats (~11 MB at 48 kHz).

## Testing

Unit: show parsing, search, ring buffer, auto-pause policy, controller rewind/context/capture hooks, hotkey rewind combo, migration + store (star, show, kind), settings defaults.
E2E: rewind saves a `kind: 'rewind'` note (film mode via settings, `__voiceNotes.rewind()`); context via a test hook that overrides the foreground provider; search/filters/star in the dashboard; film-mode dot on the idle pill.

## Out of scope

Screenshots, auto-file by show, configurable rewind hotkey, toggling film mode from the pill.
