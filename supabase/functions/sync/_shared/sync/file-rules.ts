import type { FileBucket } from './file-bucket.ts';
import { type DownloadRequest, type DownloadResponse, FILE_LIMITS, type PushRequest, type UploadRequest, type UploadResponse } from './protocol.ts';
import type { SyncStore } from './server-core.ts';

// Who may upload or download which file, and removing files whose note or page is gone. A file may
// be uploaded only while a live row of the same account needs it, so a PC that missed a delete can't
// bring a file back. Pure TypeScript (runs in Node and Deno).

const SWEEP_EVERY_MS = 3_600_000;
const IMAGE_GRACE_MS = 24 * 3_600_000; // an image can arrive before the page body that references it

export class FileRules {
  private readonly lastSweep = new Map<string, number>();

  constructor(
    private readonly store: Pick<SyncStore, 'fileOwner' | 'liveFiles'>,
    private readonly bucket: FileBucket,
    private readonly now: () => number = Date.now,
  ) {}

  async upload(userId: string, req: UploadRequest): Promise<UploadResponse> {
    if (req.size > FILE_LIMITS[req.kind]) return { status: 'too-large' };
    const owner = await this.store.fileOwner(userId, req.kind, req.name);
    if (owner === 'none') return { status: 'not-yet' };
    if (owner === 'deleted') return { status: 'gone' };
    return { status: 'ok', url: await this.bucket.signUpload(req.kind, `${userId}/${req.name}`) };
  }

  async download(userId: string, req: DownloadRequest): Promise<DownloadResponse> {
    const url = await this.bucket.signDownload(req.kind, `${userId}/${req.name}`);
    return url ? { status: 'ok', url } : { status: 'not-uploaded' };
  }

  /** After a push commits: remove the audio of notes it deleted, and sweep the account at most hourly. */
  async afterPush(userId: string, req: PushRequest): Promise<void> {
    const deleted = req.mutations.flatMap((m) => (m.op.op === 'note.delete' ? [`${userId}/${m.op.id}.webm`] : []));
    if (deleted.length) await this.bucket.remove('audio', deleted);
    const now = this.now();
    if (now - (this.lastSweep.get(userId) ?? -Infinity) < SWEEP_EVERY_MS) return;
    this.lastSweep.set(userId, now);
    const live = await this.store.liveFiles(userId);
    const audio = (await this.bucket.list('audio', userId)).filter((o) => !live.audio.has(o.name));
    if (audio.length) await this.bucket.remove('audio', audio.map((o) => `${userId}/${o.name}`));
    const images = (await this.bucket.list('image', userId)).filter((o) => !live.images.has(o.name) && now - o.createdAt > IMAGE_GRACE_MS);
    if (images.length) await this.bucket.remove('image', images.map((o) => `${userId}/${o.name}`));
  }
}
