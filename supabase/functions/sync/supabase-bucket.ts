// FileBucket on Supabase Storage, with the function's service role (the buckets have no client
// policies: this is the only way in). Signed URLs last 2 minutes.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { BucketObject, FileBucket } from './_shared/sync/file-bucket.ts';
import type { FileKind } from './_shared/sync/protocol.ts';

const BUCKETS: Record<FileKind, string> = { audio: 'audio', image: 'images' };
const URL_SECONDS = 120;
const PAGE = 1000;

export class SupabaseBucket implements FileBucket {
  constructor(private readonly client: SupabaseClient) {}

  private bucket(kind: FileKind) {
    return this.client.storage.from(BUCKETS[kind]);
  }

  async signUpload(kind: FileKind, path: string): Promise<string> {
    const { data, error } = await this.bucket(kind).createSignedUploadUrl(path, { upsert: true });
    if (error) throw error;
    return data.signedUrl;
  }

  async signDownload(kind: FileKind, path: string): Promise<string | null> {
    const { data, error } = await this.bucket(kind).createSignedUrl(path, URL_SECONDS);
    if (error) {
      if (/not.?found/i.test(error.message)) return null;
      throw error;
    }
    return data.signedUrl;
  }

  async remove(kind: FileKind, paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += PAGE) {
      const { error } = await this.bucket(kind).remove(paths.slice(i, i + PAGE));
      if (error) throw error;
    }
  }

  async list(kind: FileKind, prefix: string): Promise<BucketObject[]> {
    const out: BucketObject[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await this.bucket(kind).list(prefix, { limit: PAGE, offset });
      if (error) throw error;
      for (const o of data) if (o.id) out.push({ name: o.name, createdAt: Date.parse(o.created_at) });
      if (data.length < PAGE) return out;
    }
  }
}
