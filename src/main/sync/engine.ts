import type { FolderRow, NoteRow, PageRow, SyncedKey, SyncOp } from '../../shared/sync-ops';

// The contract between a PC and the sync server. The reference server in tests/unit/sync implements
// it in memory; piece C implements it on Supabase.

export type PushRequest = {
  clientId: string;
  deviceName: string;
  mutations: { id: string; op: SyncOp; baseVersion: number }[];
};
export type PushResponse = { acked: { id: string; version: number }[] };

export type ServerRow =
  | { entity: 'note'; id: string; version: number; deleted: boolean; data: NoteRow | null }
  | { entity: 'page'; id: string; version: number; deleted: boolean; data: PageRow | null }
  | { entity: 'folder'; id: string; version: number; deleted: boolean; data: FolderRow | null };

export type PullResponse = {
  cursor: number;
  hasMore: boolean;
  rows: ServerRow[];
  prefs: { key: SyncedKey; value: unknown; version: number }[];
};

export type SyncServer = {
  push(req: PushRequest): Promise<PushResponse>;
  pull(req: { clientId: string; cursor: number }): Promise<PullResponse>;
};
