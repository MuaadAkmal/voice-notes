import type { FolderRow, NoteRow, PageRow, SyncedKey, SyncOp } from '../sync-ops.ts';

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

export const PUSH_MAX_MUTATIONS = 100;
export const PULL_PAGE_SIZE = 500;
