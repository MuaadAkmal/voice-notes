import type { GestureEvent } from '../hotkey/gesture';
import { MAX_SECONDS } from '../../shared/asr/protocol';
import type { OverlayState } from '../../shared/ipc';
import { MIN_DICTATION_MS } from '../../shared/dictation';
import { afterCalendarTrigger, parseCalendarCommand } from '../../shared/calendar-command';
import { parseNoteCommand } from '../../shared/note-command';
import { isReminder } from '../../shared/reminder-command';
import type { Capture } from '../commands/capture';

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
  /** The window in front, read at start with the app label, for a list command's "this". */
  getCapture?(): Capture | null;
  /** WAV → text. Throws an Error whose message is fit for the pill. */
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>;
  save(text: string, app: string | null): void;
  paste(text: string): Promise<void>;
  idleState(): OverlayState;
  /** Voice to calendar: a transcript starting with a trigger becomes an event instead of being pasted. */
  calendar?: {
    enabled(): boolean;
    /** Quick Add; the message is fit for the pill ("Added · Lunch · Fri 30 Oct, 13:00" or why not). */
    add(text: string): Promise<{ ok: boolean; message: string }>;
  };
  /** Voice to lists: a transcript starting with a wake word ("Pixie") adds its items to one of the pages (or Quick notes) instead. */
  list?: {
    enabled(): boolean;
    /** The names that start a command ("Pixie, …"). */
    wakeWords(): string[];
    /** The message is fit for the pill ("Added · blueberry → Groceries" or why not). */
    add(text: string, capture: Capture | null): Promise<{ ok: boolean; message: string }>;
  };
  /** Voice reminders: "remind me to … in 10 min", alone or after the wake word or calendar trigger. */
  reminder?: {
    enabled(): boolean;
    /** Gets the text from "remind me" on; the message is fit for the pill ("Reminder · call mom · 5:40 PM"). */
    add(text: string): Promise<{ ok: boolean; message: string }>;
  };
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

type State = 'idle' | 'listening' | 'stopping' | 'transcribing' | 'adding' | 'pasting';

/**
 * One dictation: idle → listening → stopping → transcribing → pasting → idle.
 * The text is stored before it is pasted, so a paste into the wrong place is never lost.
 * A calendar or list command goes transcribing → adding instead, and is pasted only if adding failed.
 */
export class DictationController {
  private _state: State = 'idle';
  private startedAt = 0;
  private app: string | null = null;
  private capture: Capture | null = null;
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
    this.maxMs = p.maxMs ?? MAX_SECONDS * 1000;
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
        this.capture = this.p.getCapture?.() ?? null;
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
    const command = this.command(text);
    try {
      this.p.save(command ? `${command.mark} ${text}` : text, this.app);
    } catch {
      // Still paste: losing the panel entry is better than losing the text.
    }
    if (command) {
      this._state = 'adding';
      this.p.overlay.setState({ kind: 'busy', message: command.busy });
      const r = await command.add().catch(() => ({ ok: false, message: command.failed }));
      if (r.ok) {
        this.toIdle();
        this.flash(r.message, 'done');
        return;
      }
      this.flash(r.message); // then paste, so nothing is lost
    } else {
      this.p.overlay.setState(this.p.idleState());
    }
    this._state = 'pasting';
    try {
      await this.p.paste(text);
    } catch {
      // The text is in the Dictation panel.
    }
    this.toIdle();
  }

  /** What the transcript asks for instead of a paste, if anything. A reminder, then the calendar trigger, then lists. */
  private command(text: string): { mark: string; busy: string; failed: string; add(): Promise<{ ok: boolean; message: string }> } | null {
    const { calendar, list, reminder } = this.p;
    if (reminder?.enabled()) {
      const asked = [text, parseNoteCommand(text, list?.wakeWords() ?? [])?.text, afterCalendarTrigger(text)]
        .map((t) => t?.trim().replace(/[\s.!?]+$/, ''))
        .find((t) => t && isReminder(t));
      if (asked) return { mark: '⏰', busy: 'Setting reminder…', failed: "Couldn't set the reminder", add: () => reminder.add(asked) };
    }
    const event = calendar?.enabled() ? parseCalendarCommand(text) : null;
    if (event && calendar) return { mark: '📅', busy: 'Adding to calendar…', failed: "Couldn't add the event.", add: () => calendar.add(event.text) };
    const items = list?.enabled() ? parseNoteCommand(text, list.wakeWords()) : null;
    if (items && list) return { mark: '📝', busy: 'Saving note…', failed: "Couldn't save the note", add: () => list.add(items.text, this.capture) };
    return null;
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

  private flash(message: string, kind: 'error' | 'done' = 'error'): void {
    this.clearFlash();
    this.p.overlay.setState(kind === 'done' ? { kind, message } : { kind, message, retry: false });
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
