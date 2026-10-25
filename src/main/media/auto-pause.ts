import type { RecordingSource } from '../../shared/channels';

type Deps = {
  enabled: () => boolean;
  /** Is sound coming out of the speakers right now? */
  probe: () => Promise<boolean>;
  /** Press the play/pause media key. */
  press: () => void;
};

/**
 * Pauses whatever is playing while a mic note records, and resumes it afterwards. Play/pause is a
 * toggle, so it only presses when sound was actually playing, and only resumes what it paused.
 */
export class AutoPause {
  private token = 0;
  private paused = false;

  constructor(private readonly deps: Deps) {}

  start(source: RecordingSource): void {
    const token = ++this.token;
    // Recording system audio while pausing it would save silence.
    if (source !== 'mic' || !this.deps.enabled()) return;
    this.deps
      .probe()
      .catch(() => false)
      .then((playing) => {
        if (!playing || token !== this.token) return; // that capture already ended
        this.deps.press();
        this.paused = true;
      });
  }

  end(): void {
    this.token++;
    if (!this.paused) return;
    this.paused = false;
    this.deps.press();
  }
}
