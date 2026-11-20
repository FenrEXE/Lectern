// Lectern's own small database (SQLite, one file in DATA_DIR).
//
// Schema changes are numbered migrations. SQLite's `user_version` remembers
// which ones have run, so each runs exactly once. To change the schema, ADD a
// new entry at the end of `migrations`; never edit one that has shipped.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

const migrations: string[] = [
  // 1: settings and a general-purpose cache
  `
  CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX cache_expires_at ON cache (expires_at);
  `,
  // 2: "Add to Library" requests
  `
  CREATE TABLE requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,
    status        TEXT NOT NULL,
    book_json     TEXT NOT NULL,
    torrent_id    TEXT NOT NULL,
    torrent_title TEXT NOT NULL,
    info_hash     TEXT,
    progress      REAL NOT NULL DEFAULT 0,
    eta_seconds   INTEGER,
    message       TEXT,
    library_path  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX requests_status ON requests (status);
  `,
];

/** Open (or create) the database and bring its schema up to date. */
export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'lectern.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Open an in-memory database, for tests. */
export function openMemoryDb(): Db {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

// ── Small helpers for the kv table ──

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}
