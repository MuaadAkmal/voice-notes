import type { GestureEvent } from '../hotkey/gesture';
import type { NewAudio } from '../store/note-store';
import type { Note, NoteContext, OverlayState, RecordingSource } from '../../shared/ipc';

export interface OverlayPort {
  start(deviceId: string | null, source: RecordingSource): void;
  stop(): void;
  cancel(): void;
  /** Encode and send back the last seconds of the film-mode buffer. */
  rewind(seconds: number): void;
  setState(state: OverlayState): void;
}

export interface NoteSink {
  create(audio: NewAudio): Promise<Note>;
}

type ControllerOpts = {
  getDeviceId: () => string | null;
  getSource: () => RecordingSource;
  onSaved: (n: Note) => void;
  idleState: () => OverlayState;
  /** Fired when the controller returns to idle without a gesture asking it to (save, error, watchdog). */
  onIdle?: () => void;
  /** A held title input timed out (e.g. the pill never got keyboard focus); main should release focus. */
  onTitleAbandoned?: () => void;
  /** Foreground window when a recording (or rewind) starts; null if unknown. */
  getContext?: () => NoteContext | null;
  getRewindSeconds?: () => number;
  /** A live capture began / ended (stop, cancel, error, or the recorder ending itself): auto-pause hooks. */
  onCaptureStart?: (source: RecordingSource) => void;
  onCaptureEnd?: () => void;
  minMs?: number;
  maxMs?: number;
  savedMs?: number;
  errorMs?: number;
  stopTimeoutMs?: number;
};

type State = 'idle' | 'recording' | 'stopping' | 'rewinding' | 'saving' | 'failed';

const HOLD_MAX_MS = 15_000; // longest a title input may keep the saved flash up
const TITLED_MS = 1000; // "Saved ✓" confirmation after a title is saved from the pill

/**
 * Owns one recording's lifecycle: idle → recording → stopping → saving → idle.
 * A failed save keeps its audio until retry() succeeds; new recordings are refused meanwhile.
 */
export class RecorderController {
  private _state: State = 'idle';
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: NewAudio | null = null;
  private requestedSource: RecordingSource = 'mic';
  private context: NoteContext | null = null;
  private capturing = false;
  private _lastSavedId: string | null = null;
  /** The "Saved ✓ · Add title" state while it's on screen; null otherwise. */
  private savedState: OverlayState | null = null;
  /** The user is typing a title: the saved flash must not time out. */
  private held = false;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly savedMs: number;
  private readonly errorMs: number;
  private readonly stopTimeoutMs: number;

  constructor(
    private readonly overlay: OverlayPort,
    private readonly sink: NoteSink,
    private readonly opts: ControllerOpts,
  ) {
    this.minMs = opts.minMs ?? 300;
    this.maxMs = opts.maxMs ?? 300_000;
    this.savedMs = opts.savedMs ?? 4000;
    this.errorMs = opts.errorMs ?? 3000;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? 5000;
  }

  get state(): State {
    return this._state;
  }

  /** The note the current/last "Saved" flash refers to; titles from the pill may only target it. */
  get lastSavedId(): string | null {
    return this._lastSavedId;
  }

  /** The user clicked "Add title": keep the saved state up until titleDone/titleCancelled. */
  holdFlash(): boolean {
    if (!this.savedState) return false;
    this.held = true;
    this.clearFlash();
    // Don't wait forever: if the input never gets focus it can never blur or be submitted.
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.endSaved();
      this.overlay.setState(this.opts.idleState());
      this.opts.onTitleAbandoned?.();
    }, HOLD_MAX_MS);
    return true;
  }

  // Both are no-ops once the hold has ended (a new recording started, or it timed out), so a late
  // blur from the closing input can't overwrite the recording pill.
  titleDone(): void {
    if (!this.held) return;
    const noteId = this._lastSavedId;
    this.endSaved();
    if (noteId) this.flash({ kind: 'saved', noteId, titled: true }, TITLED_MS);
  }

  titleCancelled(): void {
    if (!this.held) return;
    this.endSaved();
    this.overlay.setState(this.opts.idleState());
  }

  /** Hovering the pill pauses the countdown; leaving restarts the full flash. */
  pauseFlash(): void {
    if (this.savedState && !this.held) this.clearFlash();
  }

  resumeFlash(): void {
    if (this.savedState && !this.held && !this.flashTimer) this.flash(this.savedState, this.savedMs);
  }

  private endSaved(): void {
    this.clearFlash();
    this.savedState = null;
    this.held = false;
  }

  handleGesture(e: GestureEvent): void {
    switch (e) {
      case 'start':
        if (this._state !== 'idle') return;
        this.endSaved();
        this._state = 'recording';
        this.startedAt = Date.now();
        this.requestedSource = this.opts.getSource();
        this.context = this.opts.getContext?.() ?? null;
        this.overlay.start(this.opts.getDeviceId(), this.requestedSource);
        this.capturing = true;
        this.opts.onCaptureStart?.(this.requestedSource);
        this.overlay.setState({ kind: 'recording', mode: 'hold', startedAt: this.startedAt, source: this.requestedSource });
        this.maxTimer = setTimeout(() => this.handleGesture('stop'), this.maxMs);
        break;
      case 'handsfree':
        if (this._state !== 'recording') return;
        this.overlay.setState({ kind: 'recording', mode: 'handsfree', startedAt: this.startedAt, source: this.requestedSource });
        break;
      case 'stop':
        if (this._state !== 'recording') return;
        this.clearMax();
        this._state = 'stopping';
        this.overlay.stop();
        this.endCapture();
        // If the overlay never answers (renderer crashed, recorder died), don't stay stuck in 'stopping'.
        this.stopTimer = setTimeout(() => this.onCaptureError('Recording lost'), this.stopTimeoutMs);
        break;
      case 'discard':
      case 'cancel':
        if (this._state !== 'recording' && this._state !== 'stopping') return;
        this.clearTimers();
        this._state = 'idle';
        this.overlay.cancel();
        this.endCapture();
        this.overlay.setState(this.opts.idleState());
        break;
    }
  }

  /** Save the last N seconds of the film-mode buffer. Only from idle; returns whether it started. */
  rewind(): boolean {
    if (this._state !== 'idle') return false;
    this.endSaved();
    this._state = 'rewinding';
    this.requestedSource = 'system';
    this.context = this.opts.getContext?.() ?? null;
    const seconds = this.opts.getRewindSeconds?.() ?? 15;
    this.overlay.setState({ kind: 'busy', message: `Saving last ${seconds} s…` });
    this.overlay.rewind(seconds);
    this.stopTimer = setTimeout(() => this.onCaptureError('Rewind failed'), this.stopTimeoutMs);
    return true;
  }

  /**
   * Accepted while 'stopping' or 'rewinding', or while 'recording' when the recorder ended on its own
   * (e.g. mic unplugged).
   */
  async onAudio(audio: NewAudio): Promise<void> {
    if (this._state !== 'stopping' && this._state !== 'recording' && this._state !== 'rewinding') return;
    const kind = this._state === 'rewinding' ? 'rewind' : 'note';
    this.endCapture();
    this.clearTimers();
    if (audio.durationMs < this.minMs) {
      this.toIdle();
      this.overlay.setState(this.opts.idleState());
      return;
    }
    this.pending = {
      ...audio,
      kind,
      windowTitle: this.context?.windowTitle ?? null,
      show: this.context?.show ?? null,
    };
    await this.save();
  }

  onCaptureError(message: string): void {
    if (this._state !== 'recording' && this._state !== 'stopping' && this._state !== 'rewinding') return;
    this.endCapture();
    this.clearTimers();
    this.toIdle();
    this.flash({ kind: 'error', message, retry: false }, this.errorMs);
  }

  async retry(): Promise<void> {
    if (this._state !== 'failed') return;
    await this.save();
  }

  private async save(): Promise<void> {
    const audio = this.pending;
    if (!audio) return;
    this._state = 'saving';
    try {
      const note = await this.sink.create(audio);
      this.pending = null;
      this.toIdle();
      this.opts.onSaved(note);
      // 'both' that came back as plain mic means system capture failed; say so in the flash.
      const micOnly = this.requestedSource === 'both' && audio.source === 'mic';
      this._lastSavedId = note.id;
      this.endSaved();
      this.savedState = micOnly ? { kind: 'saved', noteId: note.id, micOnly: true } : { kind: 'saved', noteId: note.id };
      this.flash(this.savedState, this.savedMs);
    } catch {
      this._state = 'failed';
      this.overlay.setState({ kind: 'error', message: 'Save failed — Retry', retry: true });
    }
  }

  /** Show a transient state, then fall back to idle unless a new recording starts first. */
  private flash(state: OverlayState, ms: number): void {
    this.clearFlash();
    this.overlay.setState(state);
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.savedState = null;
      this.overlay.setState(this.opts.idleState());
    }, ms);
  }

  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  private endCapture(): void {
    if (!this.capturing) return;
    this.capturing = false;
    this.opts.onCaptureEnd?.();
  }

  private toIdle(): void {
    this._state = 'idle';
    this.opts.onIdle?.();
  }

  private clearMax(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
  }

  private clearTimers(): void {
    this.clearMax();
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }
}
