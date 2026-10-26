import type Database from 'better-sqlite3';

// Append-only. Index i upgrades user_version i → i+1. Never edit a shipped entry.
export const MIGRATIONS: string[] = [
  `CREATE TABLE notes (
     id          TEXT PRIMARY KEY,
     title       TEXT NOT NULL,
     file_path   TEXT NOT NULL,
     duration_ms INTEGER NOT NULL,
     size_bytes  INTEGER NOT NULL,
     mime_type   TEXT NOT NULL,
     status      TEXT NOT NULL CHECK (status IN ('ok', 'missing')),
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL,
     synced_at   INTEGER
   );
   CREATE INDEX notes_created_at ON notes (created_at);`,
  `CREATE TABLE folders (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     parent_id  TEXT REFERENCES folders(id),
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX folders_parent ON folders (parent_id);
   ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES folders(id);
   CREATE INDEX notes_folder ON notes (folder_id);`,
  `ALTER TABLE notes ADD COLUMN source TEXT NOT NULL DEFAULT 'mic' CHECK (source IN ('mic', 'system', 'both'));`,
  `ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'rewind'));
   ALTER TABLE notes ADD COLUMN window_title TEXT;
   ALTER TABLE notes ADD COLUMN show TEXT;
   ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX notes_show ON notes (show);`,
  `CREATE TABLE pages (
     id         TEXT PRIMARY KEY,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL DEFAULT '',
     folder_id  TEXT REFERENCES folders(id),
     starred    INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     synced_at  INTEGER
   );
   CREATE INDEX pages_folder ON pages (folder_id);`,
  `ALTER TABLE notes ADD COLUMN transcript TEXT;
   ALTER TABLE notes ADD COLUMN transcript_lang TEXT;
   ALTER TABLE notes ADD COLUMN transcribed_at INTEGER;`,
  `CREATE TABLE dictations (
     id         TEXT PRIMARY KEY,
     text       TEXT NOT NULL,
     app        TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX dictations_created_at ON dictations (created_at);`,
];

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  MIGRATIONS.slice(current).forEach((sql, i) => {
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${current + i + 1}`);
    })();
  });
}
