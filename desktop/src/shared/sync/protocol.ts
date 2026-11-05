import type { FolderRow, NoteRow, PageRow, SyncedKey, SyncOp } from '../sync-ops';

// The wire contract between a PC and the sync server (the app, the Edge Function and the tests).

export type PushRequest = {
  clientId: string;
  deviceName: string;
  mutations: { id: string; op: SyncOp; baseVersion: number }[];
};
export type PushResponse = { acked: { id: string; version: number }[] };

export type PullRequest = { clientId: string; cursor: number };

export type ServerRow =
  | { entity: 'note'; id: string; version: number; deleted: boolean; data: NoteRow | null }
  | { entity: 'page'; id: string; version: number; deleted: boolean; data: PageRow | null }
  | { entity: 'folder'; id: string; version: number; deleted: boolean; data: FolderRow | null };

export type PullPref = { key: SyncedKey; value: unknown; version: number };

export type PullResponse = {
  cursor: number;
  hasMore: boolean;
  rows: ServerRow[];
  prefs: PullPref[];
};

export type SyncServer = {
  push(req: PushRequest): Promise<PushResponse>;
  pull(req: PullRequest): Promise<PullResponse>;
};

// Files (audio, page images): the function hands out short-lived signed URLs; bytes go straight to Storage.
export type FileKind = 'audio' | 'image';
/** `full`: this app understands `storage-full`. Older apps drop a file on any status they don't know, so they're told `not-yet` instead. */
export type UploadRequest = { kind: FileKind; name: string; size: number; full?: boolean };
/** `storage-full`: the account's plan has no room for this file; try again later. */
export type UploadResponse = { status: 'ok'; url: string } | { status: 'not-yet' | 'gone' | 'too-large' | 'storage-full' };
/** The account's synced audio and images against its plan's cap, in bytes (`storage` route). */
export type StorageResponse = { used: number; limit: number };
export type DownloadRequest = { kind: FileKind; name: string };
export type DownloadResponse = { status: 'ok'; url: string } | { status: 'not-uploaded' };
export const FILE_LIMITS: Record<FileKind, number> = { audio: 50 * 1024 * 1024, image: 20 * 1024 * 1024 };
export const AUDIO_FILE_RE = /^[0-9a-f-]{36}\.webm$/;

export const PUSH_MAX_MUTATIONS = 100;
export const PULL_PAGE_SIZE = 500;
