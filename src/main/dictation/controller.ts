import type { GestureEvent } from '../hotkey/gesture';
import type { OverlayState } from '../../shared/ipc';
import { MIN_DICTATION_MS } from '../../shared/dictation';

export type DictationPorts = {
  overlay: { start(deviceId: string | null, ping: boolean): void; stop(): void; cancel(): void; setState(s: OverlayState): void };
  /** A transcription server is set up. */
  configured(): boolean;
  /** A voice note is recording, saving or waiting for a retry: dictation must not start. */
  blocked(): boolean;
  getDeviceId(): string | null;
  sound(): boolean;
  /** Show label of the window being dictated into, read at start. */
  getApp(): string | null;
  /** WAV → text. Throws an Error whose message is fit for the pill. */
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>;
  save(text: string, app: string | null): void;
  paste(text: string): Promise<void>;
  idleState(): OverlayState;
  /** Back to idle (keep the gesture in step). */
  onIdle?(): void;
  onCaptureStart?(): void;
  onCaptureEnd?(): void;
  /** Listening started: a built-in engine can load its model while the user speaks. */
  prewarm?(): void;
  minMs?: number;
  errorMs?: number;
  stopTimeoutMs?: number;
  maxMs?: number;
};

type State = 'idle' | 'listening' | 'stopping' | 'transcribing' | 'pasting';

/**
 * One dictation: idle → listening → stopping → transcribing → pasting → idle.
 * The text is stored before it is pasted, so a paste into the wrong place is never lost.
 */
export class DictationController {
  private _state: State = 'idle';
  private startedAt = 0;
  private app: string | null = null;
  private capturing = false;
  private request: AbortController | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly minMs: number;
  private readonly errorMs: number;
  private readonly stopTimeoutMs: number;
  private readonly maxMs: number;

  constructor(private readonly p: DictationPorts) {
    this.minMs = p.minMs ?? MIN_DICTATION_MS;
    this.errorMs = p.errorMs ?? 3000;
    this.stopTimeoutMs = p.stopTimeoutMs ?? 5000;
    this.maxMs = p.maxMs ?? 300_000;
  }

  get state(): State {
    return this._state;
  }

  get active(): boolean {
    return this._state !== 'idle';
  }

  handleGesture(e: GestureEvent): void {
    switch (e) {
      case 'start':
        if (this._state !== 'idle' || this.p.blocked()) return;
        if (!this.p.configured()) {
          this.flash('Set up transcription first');
          return;
        }
        this.clearFlash();
        this.p.prewarm?.();
        this._state = 'listening';
        this.startedAt = Date.now();
        this.app = this.p.getApp();
        this.p.overlay.start(this.p.getDeviceId(), this.p.sound());
        this.capturing = true;
        this.p.onCaptureStart?.();
        this.showRecording('hold');
        this.maxTimer = setTimeout(() => this.handleGesture('stop'), this.maxMs);
        break;
      case 'handsfree':
        if (this._state === 'listening') this.showRecording('handsfree');
        break;
      case 'stop':
        if (this._state !== 'listening') return;
        this.clearTimers();
        this._state = 'stopping';
        this.p.overlay.stop();
        this.endCapture();
        // The overlay never answered (renderer crashed, recorder died): don't stay stuck.
        this.stopTimer = setTimeout(() => this.fail('Recording failed'), this.stopTimeoutMs);
        break;
      case 'discard':
      case 'cancel':
        if (this._state !== 'listening' && this._state !== 'stopping' && this._state !== 'transcribing') return;
        if (this._state !== 'transcribing') this.p.overlay.cancel();
        this.request?.abort();
        this.request = null;
        this.clearTimers();
        this.endCapture();
        this.toIdle();
        this.p.overlay.setState(this.p.idleState());
        break;
    }
  }

  /** The clip as WAV. Accepted while stopping, or while listening when the recorder ended on its own. */
  async onAudio(a: { bytes: Uint8Array; durationMs: number }): Promise<void> {
    if (this._state !== 'stopping' && this._state !== 'listening') return;
    this.clearTimers();
    this.endCapture();
    if (a.durationMs < this.minMs) {
      this.toIdle();
      this.p.overlay.setState(this.p.idleState());
      return;
    }
    this._state = 'transcribing';
    this.p.overlay.setState({ kind: 'busy', message: 'Transcribing…' });
    const request = new AbortController();
    this.request = request;
    let text: string;
    try {
      text = (await this.p.transcribe(a.bytes, request.signal)).trim();
    } catch (err) {
      if (this.request !== request) return; // cancelled meanwhile
      this.request = null;
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    }
    if (this.request !== request) return;
    this.request = null;
    if (!text) {
      this.fail('No speech heard');
      return;
    }
    try {
      this.p.save(text, this.app);
    } catch {
      // Still paste: losing the panel entry is better than losing the text.
    }
    this._state = 'pasting';
    this.p.overlay.setState(this.p.idleState());
    try {
      await this.p.paste(text);
    } catch {
      // The text is in the Dictation panel.
    }
    this.toIdle();
  }

  onCaptureError(message: string): void {
    if (this._state !== 'listening' && this._state !== 'stopping') return;
    this.fail(message);
  }

  /** A voice note takes over the pill: drop a pending error flash without touching the state shown. */
  dismissFlash(): void {
    this.clearFlash();
  }

  private showRecording(mode: 'hold' | 'handsfree'): void {
    this.p.overlay.setState({ kind: 'recording', mode, startedAt: this.startedAt, source: 'mic', dictation: true });
  }

  private fail(message: string): void {
    this.clearTimers();
    this.endCapture();
    if (this._state !== 'idle') this.toIdle();
    this.flash(message);
  }

  private flash(message: string): void {
    this.clearFlash();
    this.p.overlay.setState({ kind: 'error', message, retry: false });
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.p.overlay.setState(this.p.idleState());
    }, this.errorMs);
  }

  private clearFlash(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = null;
  }

  private endCapture(): void {
    if (!this.capturing) return;
    this.capturing = false;
    this.p.onCaptureEnd?.();
  }

  private toIdle(): void {
    this._state = 'idle';
    this.p.onIdle?.();
  }

  private clearTimers(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.stopTimer = null;
    this.maxTimer = null;
  }
}
