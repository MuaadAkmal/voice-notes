type Pending = {
  resolve: (b: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const NO_DASHBOARD = 'Open the dashboard to transcribe';

/**
 * Main has no audio decoder, so the dashboard turns a clip into WAV. Each request carries an id
 * the dashboard echoes back with the result.
 */
export class WavBridge {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly timeoutMs = 60_000) {}

  /** `send` delivers the request to the dashboard and returns false when there is none. */
  request(send: (requestId: number) => boolean): Promise<Uint8Array> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(NO_DASHBOARD));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!send(id)) this.settle(id, { error: NO_DASHBOARD });
    });
  }

  /** Late or unknown replies are ignored. */
  settle(
    requestId: number,
    result: { bytes: Uint8Array } | { error: string },
  ): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    if ('bytes' in result) p.resolve(result.bytes);
    else p.reject(new Error(result.error));
  }
}
