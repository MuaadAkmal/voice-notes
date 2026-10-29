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
  // Sync prep: deletes become tombstones, rows remember the server version they were synced at,
  // and local changes queue in the outbox (see docs/superpowers/specs/2026-10-26-sync-prep-design.md).
  `ALTER TABLE notes   ADD COLUMN deleted_at INTEGER;
   ALTER TABLE notes   ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE pages   ADD COLUMN deleted_at INTEGER;
   ALTER TABLE pages   ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE folders ADD COLUMN deleted_at INTEGER;
   ALTER TABLE folders ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE outbox (
     seq          INTEGER PRIMARY KEY AUTOINCREMENT,
     mutation_id  TEXT NOT NULL UNIQUE,
     op           TEXT NOT NULL,
     entity_id    TEXT NOT NULL,
     payload      TEXT NOT NULL,
     base_version INTEGER NOT NULL,
     in_flight    INTEGER NOT NULL DEFAULT 0,
     sent         INTEGER NOT NULL DEFAULT 0,
     created_at   INTEGER NOT NULL
   );
   CREATE INDEX outbox_entity ON outbox (entity_id);
   CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // Sync files: a note's audio can be in the account but not on this PC yet ('remote'), which needs
  // a table rebuild for the CHECK; files waiting to upload queue in file_outbox.
  `CREATE TABLE notes_new (
     id              TEXT PRIMARY KEY,
     title           TEXT NOT NULL,
     file_path       TEXT NOT NULL,
     duration_ms     INTEGER NOT NULL,
     size_bytes      INTEGER NOT NULL,
     mime_type       TEXT NOT NULL,
     status          TEXT NOT NULL CHECK (status IN ('ok', 'missing', 'remote')),
     created_at      INTEGER NOT NULL,
     updated_at      INTEGER NOT NULL,
     synced_at       INTEGER,
     folder_id       TEXT REFERENCES folders(id),
     source          TEXT NOT NULL DEFAULT 'mic' CHECK (source IN ('mic', 'system', 'both')),
     kind            TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'rewind')),
     window_title    TEXT,
     show            TEXT,
     starred         INTEGER NOT NULL DEFAULT 0,
     transcript      TEXT,
     transcript_lang TEXT,
     transcribed_at  INTEGER,
     deleted_at      INTEGER,
     version         INTEGER NOT NULL DEFAULT 0
   );
   INSERT INTO notes_new (id, title, file_path, duration_ms, size_bytes, mime_type, status, created_at, updated_at, synced_at,
     folder_id, source, kind, window_title, show, starred, transcript, transcript_lang, transcribed_at, deleted_at, version)
   SELECT id, title, file_path, duration_ms, size_bytes, mime_type, status, created_at, updated_at, synced_at,
     folder_id, source, kind, window_title, show, starred, transcript, transcript_lang, transcribed_at, deleted_at, version FROM notes;
   DROP TABLE notes;
   ALTER TABLE notes_new RENAME TO notes;
   CREATE INDEX notes_created_at ON notes (created_at);
   CREATE INDEX notes_folder ON notes (folder_id);
   CREATE INDEX notes_show ON notes (show);
   CREATE TABLE file_outbox (
     kind       TEXT NOT NULL CHECK (kind IN ('audio', 'image')),
     name       TEXT NOT NULL,
     attempts   INTEGER NOT NULL DEFAULT 0,
     next_at    INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (kind, name)
   );`,
  // Finished pomodoro focus sessions, for the Pomodoro page (this PC only, never synced).
  `CREATE TABLE pomodoro_sessions (
     id           TEXT PRIMARY KEY,
     completed_at INTEGER NOT NULL,
     focus_ms     INTEGER NOT NULL
   );
   CREATE INDEX pomodoro_sessions_completed_at ON pomodoro_sessions (completed_at);`,
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
