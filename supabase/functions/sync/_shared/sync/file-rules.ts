import type { FileBucket } from './file-bucket.ts';
import { type DownloadRequest, type DownloadResponse, FILE_LIMITS, type FileKind, type PushRequest, type UploadRequest, type UploadResponse } from './protocol.ts';
import type { SyncStore } from './server-core.ts';

// Who may upload or download which file, and removing files whose note or page is gone. A file may
// be uploaded only while a live row of the same account needs it, so a PC that missed a delete can't
// bring a file back. Pure TypeScript (runs in Node and Deno).

const SWEEP_EVERY_MS = 3_600_000;
const IMAGE_GRACE_MS = 24 * 3_600_000; // an image can arrive before the page body that references it

/** Bytes the account's files take and its plan allows (`storage_usage_for`); null: no cap. */
export type StorageQuota = (userId: string) => Promise<{ used: number; limit: number } | null>;
/**
 * Reserves room for one file against the plan, atomically with other uploads (`storage_reserve`);
 * false: it doesn't fit. Used instead of the quota check when given.
 */
export type StorageReserve = (userId: string, kind: FileKind, path: string, size: number) => Promise<boolean>;
/** The account's files that arrived bigger than their upload was reserved for (`storage_oversized`); null: every account's. */
export type StorageOversized = (userId: string | null) => Promise<{ kind: FileKind; path: string }[]>;

export class FileRules {
  private readonly lastSweep = new Map<string, number>();

  constructor(
    private readonly store: Pick<SyncStore, 'fileOwner' | 'liveFiles'>,
    private readonly bucket: FileBucket,
    private readonly now: () => number = Date.now,
    private readonly quota: StorageQuota = async () => null,
    private readonly reserve?: StorageReserve,
    private readonly oversized?: StorageOversized,
  ) {}

  async upload(userId: string, req: UploadRequest): Promise<UploadResponse> {
    if (req.size > FILE_LIMITS[req.kind]) return { status: 'too-large' };
    const owner = await this.store.fileOwner(userId, req.kind, req.name);
    if (owner === 'none') return { status: 'not-yet' };
    if (owner === 'deleted') return { status: 'gone' };
    const path = `${userId}/${req.name}`;
    // Over the plan: the file waits on the PC. An app too old to know `storage-full` keeps it queued on `not-yet`.
    if (!(await this.fits(userId, req, path))) return { status: req.full ? 'storage-full' : 'not-yet' };
    return { status: 'ok', url: await this.bucket.signUpload(req.kind, path) };
  }

  private async fits(userId: string, req: UploadRequest, path: string): Promise<boolean> {
    await this.removeOversized(userId);
    if (this.reserve) return this.reserve(userId, req.kind, path, req.size);
    const q = await this.quota(userId);
    return !q || q.used + req.size <= q.limit;
  }

  /** Every account's files uploaded bigger than claimed, for the scheduled job: one that went quiet keeps none. */
  async sweepOversized(): Promise<void> {
    await this.removeOversized(null);
  }

  /** Removes files uploaded bigger than claimed: a size the quota never saw can't stay. */
  private async removeOversized(userId: string | null): Promise<void> {
    const files = (await this.oversized?.(userId)) ?? [];
    for (const kind of ['audio', 'image'] as const) {
      const paths = files.filter((f) => f.kind === kind).map((f) => f.path);
      if (paths.length) await this.bucket.remove(kind, paths);
    }
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
    await this.removeOversized(userId);
    // Objects first, rows second: an upload URL is only issued once its row exists, so every object
    // listed here has a row the later read sees (the other order could delete a fresh upload).
    const listedAudio = await this.bucket.list('audio', userId);
    const listedImages = await this.bucket.list('image', userId);
    const live = await this.store.liveFiles(userId);
    const audio = listedAudio.filter((o) => !live.audio.has(o.name));
    if (audio.length) await this.bucket.remove('audio', audio.map((o) => `${userId}/${o.name}`));
    const images = listedImages.filter((o) => !live.images.has(o.name) && now - o.createdAt > IMAGE_GRACE_MS);
    if (images.length) await this.bucket.remove('image', images.map((o) => `${userId}/${o.name}`));
  }
}
