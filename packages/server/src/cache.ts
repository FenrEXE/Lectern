// A simple time-limited cache in SQLite, so repeat lookups are instant and
// outside services (especially MAM) aren't asked the same thing twice.
import type { Db } from './db.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function cacheGet<T>(db: Db, key: string, now = Date.now()): T | undefined {
  const row = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?').get(key) as
    | { value: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at <= now) return undefined;
  return JSON.parse(row.value) as T;
}

export function cacheSet(db: Db, key: string, value: unknown, ttlMs: number, now = Date.now()): void {
  db.prepare(
    `INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
  ).run(key, JSON.stringify(value), now + ttlMs);
}

/** Return the cached value, or run `load`, cache its result and return it. */
export async function cached<T>(db: Db, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(db, key);
  if (hit !== undefined) return hit;
  const value = await load();
  cacheSet(db, key, value, ttlMs);
  return value;
}

/** Delete expired entries. Called now and then so the file doesn't grow forever. */
export function pruneCache(db: Db, now = Date.now()): number {
  return db.prepare('DELETE FROM cache WHERE expires_at <= ?').run(now).changes;
}
