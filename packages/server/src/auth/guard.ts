// Who is asking? Runs before every request:
//
//  - reads the session cookie and attaches the signed-in profile (req.user);
//  - blocks state-changing requests that come from another website (their
//    Origin header doesn't match), on top of the SameSite cookie;
//  - requires sign-in for every /api route except a short public list, and
//    admin for /api/admin/*.
import type { FastifyInstance } from 'fastify';
import type { Profile } from '@lectern/shared';
import { readCookie, SESSION_COOKIE, type SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: Profile | null;
    sessionToken: string | null;
  }
}

/** API routes that work without signing in. */
const PUBLIC = new Set(['/api/health', '/api/auth/me', '/api/auth/profiles', '/api/auth/login', '/api/auth/setup']);

export function installGuard(app: FastifyInstance, sessions: SessionStore, users: UserStore): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        let sameSite = false;
        try {
          // req.host honours TRUST_PROXY, so this also works behind a reverse proxy.
          sameSite = new URL(origin).host === req.host;
        } catch {
          sameSite = false;
        }
        if (!sameSite) return reply.code(403).send({ error: 'Blocked a request from another website.' });
      }
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      const userId = sessions.userFor(token);
      const user = userId !== undefined ? users.get(userId) : undefined;
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }

    // Decide by the route that will actually answer (its pattern, such as
    // "/api/admin/users/:id"), never by the address as typed. Addresses can be
    // written in disguise ("/%61pi/admin/..." also reaches /api/admin/...),
    // but the matched route can't.
    const route = req.routeOptions.url;
    if (!route?.startsWith('/api/')) return; // the web app's files, or "not found"
    if (PUBLIC.has(route)) return;
    if (!req.user) return reply.code(401).send({ error: 'Please sign in.' });
    if (route.startsWith('/api/admin/') && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Only an admin can do that.' });
    }
  });
}

/**
 * Slows down password guessing. Every try counts as soon as it starts (so
 * sending many at once doesn't help), and a correct password clears the count.
 *
 * Limits per 15 minutes, by what the key starts with:
 *  - "ip:"   5 tries from one address, whatever the name;
 *  - "name:" 20 tries at one name from anywhere (higher, so a stranger can't
 *            easily lock someone out of their own profile);
 *  - anything else (such as "me:<id>" for "current password"): 5.
 * After that, the key is paused for 15 minutes.
 */
export class LoginLimiter {
  private readonly attempts = new Map<string, { tries: number; since: number; lockedUntil: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  static readonly WINDOW = 15 * 60 * 1000;

  private static limitFor(key: string): number {
    return key.startsWith('name:') ? 20 : 5;
  }

  /** Milliseconds until trying is allowed again for any of these keys (0 = now). */
  waitFor(keys: string[]): number {
    const now = this.now();
    return Math.max(0, ...keys.map((k) => (this.attempts.get(k)?.lockedUntil ?? 0) - now));
  }

  /**
   * Start a try. Returns 0 and counts it, or the milliseconds to wait (and
   * doesn't count it). Call succeeded() if the password turns out right.
   */
  attempt(keys: string[]): number {
    const wait = this.waitFor(keys);
    if (wait > 0) return wait;
    const now = this.now();
    for (const key of keys) {
      const a = this.attempts.get(key);
      if (!a || (now - a.since > LoginLimiter.WINDOW && a.lockedUntil <= now)) {
        this.attempts.set(key, { tries: 1, since: now, lockedUntil: 0 });
        continue;
      }
      a.tries++;
      if (a.tries >= LoginLimiter.limitFor(key)) a.lockedUntil = now + LoginLimiter.WINDOW;
    }
    // Keep the map from growing forever.
    if (this.attempts.size > 5_000) {
      for (const [k, a] of this.attempts) if (now - a.since > LoginLimiter.WINDOW && a.lockedUntil < now) this.attempts.delete(k);
    }
    return 0;
  }

  succeeded(keys: string[]): void {
    for (const key of keys) this.attempts.delete(key);
  }
}

/** "Try again in 12 minutes." */
export function waitMessage(ms: number, what = 'wrong passwords'): string {
  const minutes = Math.ceil(ms / 60_000);
  return `Too many ${what}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}
