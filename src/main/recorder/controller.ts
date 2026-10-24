import type { GestureEvent } from '../hotkey/gesture';
import type { NewAudio } from '../store/note-store';
import type { Note, OverlayState } from '../../shared/ipc';

export interface OverlayPort {
  start(deviceId: string | null): void;
  stop(): void;
  cancel(): void;
  setState(state: OverlayState): void;
}

export interface NoteSink {
  create(audio: NewAudio): Promise<Note>;
}

type ControllerOpts = {
  getDeviceId: () => string | null;
  onSaved: (n: Note) => void;
  idleState: () => OverlayState;
  minMs?: number;
  maxMs?: number;
  savedMs?: number;
  errorMs?: number;
};

type State = 'idle' | 'recording' | 'stopping' | 'saving' | 'failed';

/**
 * Owns one recording's lifecycle: idle → recording → stopping → saving → idle.
 * A failed save keeps its audio until retry() succeeds; new recordings are refused meanwhile.
 */
export class RecorderController {
  private _state: State = 'idle';
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: NewAudio | null = null;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly savedMs: number;
  private readonly errorMs: number;

  constructor(
    private readonly overlay: OverlayPort,
    private readonly sink: NoteSink,
    private readonly opts: ControllerOpts,
  ) {
    this.minMs = opts.minMs ?? 300;
    this.maxMs = opts.maxMs ?? 300_000;
    this.savedMs = opts.savedMs ?? 1000;
    this.errorMs = opts.errorMs ?? 3000;
  }

  get state(): State {
    return this._state;
  }

  handleGesture(e: GestureEvent): void {
    switch (e) {
      case 'start':
        if (this._state !== 'idle') return;
        this.clearFlash();
        this._state = 'recording';
        this.startedAt = Date.now();
        this.overlay.start(this.opts.getDeviceId());
        this.overlay.setState({ kind: 'recording', mode: 'hold', startedAt: this.startedAt });
        this.maxTimer = setTimeout(() => this.handleGesture('stop'), this.maxMs);
        break;
      case 'handsfree':
        if (this._state !== 'recording') return;
        this.overlay.setState({ kind: 'recording', mode: 'handsfree', startedAt: this.startedAt });
        break;
      case 'stop':
        if (this._state !== 'recording') return;
        this.clearMax();
        this._state = 'stopping';
        this.overlay.stop();
        break;
      case 'discard':
      case 'cancel':
        if (this._state !== 'recording' && this._state !== 'stopping') return;
        this.clearMax();
        this._state = 'idle';
        this.overlay.cancel();
        this.overlay.setState(this.opts.idleState());
        break;
    }
  }

  async onAudio(audio: NewAudio): Promise<void> {
    if (this._state !== 'stopping') return;
    if (audio.durationMs < this.minMs) {
      this._state = 'idle';
      this.overlay.setState(this.opts.idleState());
      return;
    }
    this.pending = audio;
    await this.save();
  }

  onCaptureError(message: string): void {
    if (this._state !== 'recording' && this._state !== 'stopping') return;
    this.clearMax();
    this._state = 'idle';
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
      this._state = 'idle';
      this.opts.onSaved(note);
      this.flash({ kind: 'saved' }, this.savedMs);
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
      this.overlay.setState(this.opts.idleState());
    }, ms);
  }

  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  private clearMax(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = null;
  }
}
