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
  // 3: profiles, sign-in sessions, and who asked for each book
  `
  CREATE TABLE users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL DEFAULT 'member',
    color                 TEXT NOT NULL,
    default_kind          TEXT NOT NULL DEFAULT 'audiobook',
    audiobook_dir         TEXT,
    audiobook_abs_library TEXT,
    ebook_dir             TEXT,
    ebook_abs_library     TEXT,
    created_at            TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);
  ALTER TABLE requests ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
  `,
  // 4: each profile's book language ("english", or "any" for no filter)
  `
  ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'english';
  `,
  // 5: Tidy up: a scan of an Audiobookshelf library, and one row per book in it.
  // "before" keeps what a book looked like before a fix, so a run can be undone.
  `
  CREATE TABLE tidy_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id   TEXT NOT NULL,
    library_name TEXT NOT NULL,
    status       TEXT NOT NULL,
    total        INTEGER NOT NULL DEFAULT 0,
    scanned      INTEGER NOT NULL DEFAULT 0,
    message      TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE TABLE tidy_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      INTEGER NOT NULL REFERENCES tidy_runs (id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    path        TEXT,
    status      TEXT NOT NULL,
    reason      TEXT,
    current     TEXT NOT NULL,
    proposed    TEXT,
    changes     TEXT NOT NULL DEFAULT '[]',
    before      TEXT,
    applied_at  TEXT,
    undone_at   TEXT,
    error       TEXT
  );
  CREATE INDEX tidy_items_run ON tidy_items (run_id, status);
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
  db.pragma('foreign_keys = ON');
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

export function deleteSetting(db: Db, key: string): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}
