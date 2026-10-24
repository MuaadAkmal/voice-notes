# Voice Notes Pill Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrolling colour-coded waveform, "No sound" warning, draggable remembered pill, title-from-pill, and a hands-free discard ×.

**Architecture:** Pure helpers (`levelFromRms`, `isSilent` in `src/shared/audio-level.ts`; `resolveOverlayBounds` in `src/main/overlay-position.ts`) carry the logic and are unit-tested. The overlay renderer gets a canvas waveform and new pill states; main gains overlay IPC for drag/title/discard, a `pillPosition` setting, and controller support for a held, titled "saved" flash.

**Tech Stack:** unchanged.

**Spec:** `docs/superpowers/specs/2026-10-25-voice-notes-pill-polish-design.md`

## Global Constraints

- All earlier constraints hold; the overlay bundle stays free of shadcn/Radix/lucide.
- Constants: sample 50 ms; history 40 bars; bar 3 px, gap 1.5 px, min 2 px; opacity 0.25→1; level floor −60 dBFS, ceiling −10 dBFS; silence threshold −50 dBFS for 3 000 ms; drag threshold 4 px; saved flash 4 000 ms (1 000 ms after a title is saved); title max 200 chars.
- Colours: mic `#f87171`, system `#38bdf8`, both `#a78bfa`; warning amber `#fbbf24`.
- Copy: `No sound — check mic/source`, `Saved ✓ · Add title`, `Saved ✓ (mic only) · Add title`, placeholder `Phrase or meaning…`, `Reset pill position`, × `aria-label="Discard recording"`.
- New overlay→main channels are validated with zod and accepted only from the overlay webContents.

## Review Focus

1. **Click vs drag on the pill** — a click with < 4 px movement must still toggle/retry/title; a drag must never also toggle → Task 3 e2e (drag persists, no recording started).
2. **Title input focus** — after Enter/Esc/blur the overlay is non-focusable again; a recording started while titling isn't blocked → Task 4 (controller tests + e2e).
3. **Saved display removed** (laptop undocked) → pill returns to the primary display → Task 3 `resolveOverlayBounds` test.
4. **`overlay:title` for a note other than the one just saved** → rejected → Task 4 unit/IPC check.
5. **Silent input** → warning shows, recording still saves → Task 2 e2e with silent fake audio.

---

### Task 1: Waveform

**Files:** create `src/shared/audio-level.ts`, `tests/unit/audio-level.test.ts`; modify `src/renderer/overlay/Pill.tsx`, `useRecorder.ts` (`fftSize 1024`).
**Interfaces:** `levelFromRms(rms: number): number` (0..1); `isSilent(rms: number): boolean` (< −50 dBFS); `rmsOf(samples: Float32Array): number`.

- [ ] RED: tests — `levelFromRms(0) === 0`, `levelFromRms(10 ** (-60 / 20)) === 0`, `levelFromRms(10 ** (-10 / 20)) === 1`, `levelFromRms(1) === 1`, midpoint −35 dBFS → 0.5 (±0.001); `isSilent(10 ** (-51/20))` true, `isSilent(10 ** (-49/20))` false; `rmsOf` of a ±0.5 square wave → 0.5.
- [ ] GREEN: implement. Replace `Waveform` with a canvas component `<Waveform analyser source />` per spec §2 (rAF draw loop; 50 ms sampling into a ring buffer; colour by source).
- [ ] Verify `npm test`, `tsc`; e2e screenshots of the pill while recording for each source (overlay window via `t.app.windows()` url `/overlay/`) to `.superpowers/shots/pill-*.png`.
- [ ] Commit `feat: scrolling colour-coded waveform`.

### Task 2: No-sound warning

**Files:** `Pill.tsx`, `useRecorder.ts` (expose silence state), `tests/e2e/launch.ts` (optional `fakeAudioFile` launch option), `tests/e2e/pill.spec.ts`, `tests/e2e/fixtures/silence.wav` (2 s, generated with ffmpeg, committed).
**Interfaces:** `useRecorder()` returns `{ analyser, silent }`.

- [ ] RED: e2e `shows "No sound" when the input is silent` — launch with `--use-file-for-fake-audio-capture=<abs>/tests/e2e/fixtures/silence.wav`, start hands-free, after 3 500 ms overlay shows `No sound — check mic/source`; stop → a note is still saved.
- [ ] GREEN: track silence in the waveform sampler; `silent` true after 3 000 ms continuous; Pill swaps the mode label.
- [ ] Commit `feat: no-sound warning while recording`.

### Task 3: Draggable, remembered pill

**Files:** create `src/main/overlay-position.ts`, `tests/unit/overlay-position.test.ts`; modify `channels.ts`/`ipc.ts` (`pillPosition` setting + `OverlayDrag`, `OverlayDragEnd` channels), `settings.ts`, `windows.ts` (`positionOverlay(win, saved)`), `index.ts`, `ipc.ts` (main), `tray.ts`, `preload/overlay.ts`, `Pill.tsx`, `SettingsPage.tsx`, `tests/unit/settings.test.ts`, `tests/e2e/pill.spec.ts`.
**Interfaces:** `resolveOverlayBounds(saved: PillPosition | null, displays: { id: number; workArea: Rect }[], primaryId: number, size: { width: number; height: number }): Rect`; `PillPosition = { displayId: number; x: number; y: number }`.

- [ ] RED: unit — null → bottom-centre of primary (16 px margin); unknown displayId → bottom-centre; saved spot inside → unchanged (offset by workArea origin); off right/bottom/left/top → clamped inside; settings `pillPosition` default null, invalid shape → null.
- [ ] GREEN: implement; overlay `pointerdown/move/up` with 4 px threshold sends `{dx,dy}`; main `setPosition`, on drag-end converts to `{displayId, x - workArea.x, y - workArea.y}` via `screen.getDisplayMatching` and saves; reposition on display events; Reset in Settings + tray.
- [ ] E2E: drag the overlay pill by (−300, −200) using `page.mouse` on the overlay window → `settings.pillPosition` non-null and window bounds moved; no note created.
- [ ] Commit `feat: drag the pill anywhere and remember it`.

### Task 4: Title from the pill

**Files:** `channels.ts`/`ipc.ts` (`saved.noteId`; `OverlayTitleStart`, `OverlayTitle`, `OverlayTitleCancel` channels + schemas), `controller.ts`, `index.ts`, `ipc.ts` (main), `preload/overlay.ts`, `Pill.tsx`, `tests/unit/controller.test.ts`, `tests/e2e/pill.spec.ts`.
**Interfaces:** controller `savedMs` default 4 000; `holdFlash(): void`; `titleDone(): void` (saved 1 000 ms then idle); `titleCancelled(): void` (idle); `get lastSavedId(): string | null`; `pauseFlash()/resumeFlash()` for hover.

- [ ] RED: controller tests — saved state `{ kind: 'saved', noteId }`; idle after 4 000 ms; `holdFlash` keeps it past 4 000 ms; `titleDone` → `{kind:'saved', noteId}` then idle after 1 000 ms; `titleCancelled` → idle immediately; a `start` gesture while held starts recording.
- [ ] GREEN: implement; main handlers: title-start → `holdFlash`, `setFocusable(true)`, `focus()`; title → validate `noteId === controller.lastSavedId`, `store.rename`, notes changed, `titleDone`; cancel → `titleCancelled`; both → `setFocusable(false)`, `blur()`; also reset focusability on recording start.
- [ ] E2E: record, click `Add title` on the overlay, type `gracias`, Enter → note title `gracias`; overlay `isFocusable()` false afterwards.
- [ ] Commit `feat: name a note from the pill right after saving`.

### Task 5: Discard × + docs

**Files:** `channels.ts` (`OverlayDiscard`), `ipc.ts` (main), `preload/overlay.ts`, `Pill.tsx`, `tests/e2e/pill.spec.ts`, `CLAUDE.md`.

- [ ] E2E (RED): hands-free record 800 ms, hover pill, click `Discard recording` → no note, pill idle.
- [ ] GREEN: × button in hands-free state → `overlay:discard` → `gesture.escape()`.
- [ ] Full `npm test` + `npm run test:e2e`; update CLAUDE.md (pill features, overlay channels, silent fixture); commit `feat: discard a hands-free clip from the pill`.
