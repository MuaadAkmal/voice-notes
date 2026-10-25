import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  durationMs: integer('duration_ms').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  mimeType: text('mime_type').notNull(),
  status: text('status', { enum: ['ok', 'missing'] }).notNull(),
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
});

export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
