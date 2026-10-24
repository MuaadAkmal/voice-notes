# Voice Notes v1: Pill Polish Addendum

Date: 2026-10-25
Status: Design approved in conversation; pending written-spec review
Extends: the v1, folders and ui/theme/system-audio specs in this folder (their constraints still apply)

## 1. Intent

Make the floating pill feel alive and more useful while recording: a readable scrolling waveform, a warning when nothing is being heard, a pill the user can move (it currently sits exactly where Wispr Flow's bar is), naming a note straight from the pill, and a mouse way to discard a hands-free clip.

## 2. Scrolling voice-memo waveform

- `<canvas>` in the pill, ~180×24 CSS px, drawn at `devicePixelRatio`.
- Every 50 ms: read time-domain data from the clip's `AnalyserNode` (`fftSize 1024`), compute RMS, convert to dBFS, map to 0..1 with `levelFromRms(rms)`: floor −60 dBFS → 0, −10 dBFS → 1, linear in dB, clamped. Push into a 40-sample ring buffer (≈2 s of history).
- Draw 40 rounded bars, 3 px wide, 1.5 px gap, mirrored around the vertical centre, min height 2 px; newest on the right; opacity ramps from 0.25 (oldest) to 1 (newest).
- Colour by source: mic `#f87171` (red-400), system `#38bdf8` (sky-400), both `#a78bfa` (violet-400).
- The analyser now feeds the waveform only; the old 24-bar frequency spectrum is removed.

## 3. "No sound" warning

- In the overlay, while recording: if every sample stays below −50 dBFS (`isSilent(rms)`) for 3 000 ms continuously, the mode label is replaced by amber text `No sound — check mic/source`; it reverts as soon as a sample is ≥ −50 dBFS. Purely renderer-side; no IPC, no effect on saving.

## 4. Move the pill

- Drag: `pointerdown` on the pill, then movement > 4 px starts a drag; the overlay sends screen-coordinate deltas (`overlay:drag` `{ dx, dy }`) and main moves the window with `setPosition`. `pointerup` after a drag sends `overlay:drag-end`; main saves the position. A press without a drag is a normal click (toggle hands-free / retry / add title).
- Setting `pillPosition: { displayId: number; x: number; y: number } | null` (window top-left relative to that display's `workArea`), default `null` (bottom-centre as today).
- On boot and on `display-metrics-changed`/`display-added`/`display-removed`: `resolveOverlayBounds(saved, displays, primaryId, size)` (pure) returns bottom-centre of the primary work area when `saved` is null or its display is gone, else the saved spot clamped fully inside that display's work area.
- "Reset pill position" in Settings (button) and in the tray menu sets `pillPosition: null` and re-positions immediately.

## 5. Title right after saving

- `OverlayState` `saved` gains `noteId: string`. The saved flash lasts 4 000 ms (was 1 000) and shows `Saved ✓ · Add title` (or `Saved ✓ (mic only) · Add title`). Hovering the pill pauses the countdown; leaving restarts the full 4 000 ms.
- Clicking it sends `overlay:title-start`; main calls `controller.holdFlash()` (cancels the flash timer), makes the overlay focusable (`setFocusable(true)`, `focus()`), and the pill becomes a text input (placeholder `Phrase or meaning…`, max 200 chars).
- Enter with non-empty text → `overlay:title` `{ noteId, title }`; main validates (uuid, 1–200 trimmed chars, `noteId` must equal the note just saved), renames via the store, broadcasts `notes:changed`, shows `Saved ✓` for 1 000 ms, then idle. Esc, blur or empty Enter → `overlay:title-cancel` → idle. Either way main calls `setFocusable(false)` and `blur()` on the overlay.
- A new recording starting while the input is open abandons it (the start path resets focusability).
- Known limitation: after the input closes, Windows usually returns focus to the previous window, but this isn't guaranteed.

## 6. Cancel ×

- During hands-free recording, hovering the pill shows a 16 px `×` button at its right end (`aria-label="Discard recording"`). Click → `overlay:discard` → `gesture.escape()` (same as Esc). Not shown in hold mode.

## 7. Testing

- Unit: `levelFromRms` (floor, ceiling, midpoint, clamping); `resolveOverlayBounds` (null → bottom-centre, missing display → bottom-centre, clamping on each edge); settings `pillPosition` validation; controller: saved state carries `noteId`, flash lasts 4 000 ms, `holdFlash()` keeps it until `titleDone()` / `titleCancelled()`.
- E2E: Add title renames the saved note (overlay window driven by Playwright); × discards a hands-free clip (no note); "No sound" appears when launched with `--use-file-for-fake-audio-capture=<silent.wav>`; dragging the pill persists `pillPosition`; screenshots of the waveform in red/blue/purple.
