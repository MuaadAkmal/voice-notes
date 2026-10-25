/** Fixed-capacity audio sample buffer: keeps only the most recent `capacity` samples. */
export class RingBuffer {
  private readonly data: Float32Array;
  private write = 0; // next index to write
  private _size = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get size(): number {
    return this._size;
  }

  push(chunk: Float32Array): void {
    const src = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk;
    const first = Math.min(src.length, this.capacity - this.write);
    this.data.set(src.subarray(0, first), this.write);
    this.data.set(src.subarray(first), 0);
    this.write = (this.write + src.length) % this.capacity;
    this._size = Math.min(this.capacity, this._size + src.length);
  }

  /** The last min(n, size) samples, oldest first, as a copy. */
  latest(n: number): Float32Array {
    const count = Math.min(n, this._size);
    const out = new Float32Array(count);
    const start = (this.write - count + this.capacity) % this.capacity;
    const first = Math.min(count, this.capacity - start);
    out.set(this.data.subarray(start, start + first));
    out.set(this.data.subarray(0, count - first), first);
    return out;
  }

  clear(): void {
    this.write = 0;
    this._size = 0;
  }
}
