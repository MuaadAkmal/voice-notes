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
