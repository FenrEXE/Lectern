// Sign-in sessions. The browser keeps a random token in a cookie; Lectern
// stores only a SHA-256 of it, so a copy of the database can't be used to
// sign in. Sessions last 30 days and renew themselves while in use.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';

export const SESSION_COOKIE = 'lectern_session';
const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
// Renew once a session is a day old, rather than writing on every request.
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Start a session; returns the token to put in the cookie. */
  create(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hash(token), userId, now, now + LIFETIME_MS);
    return token;
  }

  /** The profile a token belongs to, or undefined if it's unknown or expired. */
  userFor(token: string): number | undefined {
    const now = this.now();
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as
      | { user_id: number; expires_at: number }
      | undefined;
    if (!row) return undefined;
    if (row.expires_at <= now) {
      this.end(token);
      return undefined;
    }
    if (row.expires_at - now < LIFETIME_MS - RENEW_AFTER_MS) {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + LIFETIME_MS, hash(token));
    }
    return row.user_id;
  }

  end(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
  }

  /** Sign a profile out everywhere (e.g. after a password change), optionally keeping one session. */
  endAllFor(userId: number, keepToken?: string): void {
    if (keepToken) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hash(keepToken));
    } else {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    }
  }

  pruneExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
  }

  /** The cookie header for a new session. */
  static cookie(token: string, secure: boolean): string {
    return [
      `${SESSION_COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(LIFETIME_MS / 1000)}`,
      ...(secure ? ['Secure'] : []),
    ].join('; ');
  }

  static clearCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
