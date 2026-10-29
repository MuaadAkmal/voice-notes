import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  durationMs: integer('duration_ms').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mimeType: text('mime_type').notNull(),
  status: text('status', { enum: ['ok', 'missing', 'remote'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  syncedAt: integer('synced_at'),
  folderId: text('folder_id'),
  source: text('source', { enum: ['mic', 'system', 'both'] }).notNull().default('mic'),
  kind: text('kind', { enum: ['note', 'rewind'] }).notNull().default('note'),
  windowTitle: text('window_title'),
  show: text('show'),
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  transcript: text('transcript'),
  transcriptLang: text('transcript_lang'),
  transcribedAt: integer('transcribed_at'),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(0),
});

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  folderId: text('folder_id'),
  starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  syncedAt: integer('synced_at'),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(0),
});

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  version: integer('version').notNull().default(0),
});

export const dictations = sqliteTable('dictations', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  app: text('app'),
  createdAt: integer('created_at').notNull(),
});

export const pomodoroSessions = sqliteTable('pomodoro_sessions', {
  id: text('id').primaryKey(),
  completedAt: integer('completed_at').notNull(),
  focusMs: integer('focus_ms').notNull(),
});

export const outbox = sqliteTable('outbox', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  mutationId: text('mutation_id').notNull().unique(),
  op: text('op').notNull(),
  entityId: text('entity_id').notNull(),
  payload: text('payload').notNull(),
  baseVersion: integer('base_version').notNull(),
  inFlight: integer('in_flight', { mode: 'boolean' }).notNull().default(false),
  sent: integer('sent', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Every column but the sync ones: what the shared Note/Page/Folder types carry. */
export function liveColumns<T extends Record<string, unknown>>(cols: T): Omit<T, 'deletedAt' | 'version'> {
  const { deletedAt: _d, version: _v, ...rest } = cols;
  return rest;
}
