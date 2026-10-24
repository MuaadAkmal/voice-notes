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
});
