import type { FileKind } from './protocol.ts';

// Where synced files live: Supabase Storage in the Edge Function (supabase/functions/sync/supabase-bucket.ts),
// memory in the tests and the e2e fixture. Paths are `<user_id>/<name>`.

export type BucketObject = { name: string; createdAt: number }; // name relative to the prefix

export interface FileBucket {
  signUpload(kind: FileKind, path: string): Promise<string>;
  /** null: no such object. */
  signDownload(kind: FileKind, path: string): Promise<string | null>;
  remove(kind: FileKind, paths: string[]): Promise<void>;
  /** Every object under `${prefix}/`. */
  list(kind: FileKind, prefix: string): Promise<BucketObject[]>;
}

/** FileBucket in memory; signed URLs point at `${baseUrl}/blob/<kind>/<path>` (served by the e2e fixture). */
export class MemoryBucket implements FileBucket {
  private readonly objects = new Map<string, { bytes: Uint8Array; createdAt: number }>();

  constructor(
    private readonly baseUrl = 'memory:',
    private readonly now: () => number = Date.now,
  ) {}

  put(kind: FileKind, path: string, bytes: Uint8Array): void {
    this.objects.set(`${kind}/${path}`, { bytes, createdAt: this.objects.get(`${kind}/${path}`)?.createdAt ?? this.now() });
  }

  get(kind: FileKind, path: string): Uint8Array | undefined {
    return this.objects.get(`${kind}/${path}`)?.bytes;
  }

  async signUpload(kind: FileKind, path: string): Promise<string> {
    return `${this.baseUrl}/blob/${kind}/${path}`;
  }

  async signDownload(kind: FileKind, path: string): Promise<string | null> {
    return this.objects.has(`${kind}/${path}`) ? `${this.baseUrl}/blob/${kind}/${path}` : null;
  }

  async remove(kind: FileKind, paths: string[]): Promise<void> {
    for (const p of paths) this.objects.delete(`${kind}/${p}`);
  }

  async list(kind: FileKind, prefix: string): Promise<{ name: string; createdAt: number }[]> {
    const start = `${kind}/${prefix}/`;
    return [...this.objects]
      .filter(([k]) => k.startsWith(start))
      .map(([k, o]) => ({ name: k.slice(start.length), createdAt: o.createdAt }));
  }
}
