// Signing in and out, first-run setup, and your own profile.
//
// GET  /api/auth/me        who's signed in (and whether Lectern needs setting up)
// GET  /api/auth/profiles  the profile cards for the sign-in page
// POST /api/auth/setup     create the first (admin) profile, only when there are none.
//                          Needs the one-time setup code Lectern prints in its log,
//                          so a stranger who finds a fresh install can't claim it.
// POST /api/auth/login     { name, password }
// POST /api/auth/logout
// PUT  /api/me             change your default kind or your password
import { randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MeResponse, Profile, ProfilesResponse } from '@lectern/shared';
import { readConfig, type ConfigSource } from '../config.js';
import { waitMessage, type LoginLimiter } from '../auth/guard.js';
import { verifyAgainstNothing, verifyPassword } from '../auth/passwords.js';
import { SessionStore } from '../auth/sessions.js';
import { UserError, type UserStore } from '../auth/users.js';
import type { Settings } from '../settings.js';

const credentials = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});

const setupBody = credentials.extend({
  code: z.string().max(40),
  showProfiles: z.boolean().optional(),
});

const meChanges = z.object({
  defaultKind: z.enum(['audiobook', 'ebook']).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().max(200).optional(),
});

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  limiter: LoginLimiter;
  settings: Settings;
  config: ConfigSource;
  /** Fixed setup code, for tests. Normally a random one is made and logged. */
  setupCode?: string;
}

// Setup codes avoid look-alike characters (0/O, 1/I/L) so they're easy to type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeSetupCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Compare codes ignoring case, spaces and dashes, in constant time. */
function sameCode(typed: string, expected: string): boolean {
  const clean = (c: string) => Buffer.from(c.toUpperCase().replace(/[\s-]/g, ''));
  const a = clean(typed);
  const b = clean(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signIn(req: FastifyRequest, reply: FastifyReply, deps: AuthDeps, profile: Profile): MeResponse {
  const token = deps.sessions.create(profile.id);
  reply.header('Set-Cookie', SessionStore.cookie(token, req.protocol === 'https'));
  return { setupNeeded: false, me: profile };
}

const sendError = (reply: FastifyReply, err: unknown) => {
  if (err instanceof UserError) return reply.code(err.statusCode).send({ error: err.message });
  throw err;
};

export function authRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { users, sessions, limiter } = deps;

  // Until the first profile exists, creating it needs this code. It's printed
  // in Lectern's log (docker logs lectern), which only the server's owner sees.
  const setupCode = deps.setupCode ?? makeSetupCode();
  if (users.count() === 0) {
    app.log.warn(`No profiles yet. To create the admin profile, open Lectern and enter the setup code ${setupCode}`);
  }

  app.get('/api/auth/me', async (req): Promise<MeResponse> => ({
    setupNeeded: users.count() === 0,
    me: req.user,
  }));

  app.get('/api/auth/profiles', async (): Promise<ProfilesResponse> => ({
    setupNeeded: users.count() === 0,
    profiles: deps.settings.options().showProfiles ? users.cards() : [],
  }));

  app.post('/api/auth/setup', async (req, reply): Promise<MeResponse | void> => {
    const parsed = setupBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter the setup code, a name and a password.' });
    if (users.count() > 0) return reply.code(409).send({ error: 'Lectern is already set up. Sign in instead.' });
    const keys = [`ip:${req.ip}`];
    const wait = limiter.attempt(keys);
    if (wait > 0) return reply.code(429).send({ error: waitMessage(wait, 'wrong setup codes') });
    if (!sameCode(parsed.data.code, setupCode)) {
      return reply.code(403).send({ error: 'That setup code isn’t right. It’s in Lectern’s log (docker logs lectern).' });
    }
    limiter.succeeded(keys);
    const { code: _code, showProfiles, ...credentialsOnly } = parsed.data;
    try {
      // The first profile is the admin. Library folders set in the environment
      // (from before profiles existed) become this profile's libraries.
      const config = readConfig(deps.config);
      const profile = await users.create({
        ...credentialsOnly,
        role: 'admin',
        libraries: {
          audiobook: { dir: config.libraries.audiobook, absLibraryId: config.audiobookshelf.libraryIds.audiobook },
          ebook: { dir: config.libraries.ebook, absLibraryId: config.audiobookshelf.libraryIds.ebook },
        },
      });
      // Two people racing to set up: only the first keeps admin.
      if (users.count() > 1) {
        users.remove(profile.id);
        return reply.code(409).send({ error: 'Lectern is already set up. Sign in instead.' });
      }
      if (showProfiles !== undefined) deps.settings.setOptions({ showProfiles });
      return signIn(req, reply, deps, profile);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/api/auth/login', async (req, reply): Promise<MeResponse | void> => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your name and password.' });
    const keys = [`ip:${req.ip}`, `name:${parsed.data.name.toLowerCase()}`];
    // Counted before the (slow) password check, so a burst of guesses sent
    // all at once is limited too.
    const wait = limiter.attempt(keys);
    if (wait > 0) return reply.code(429).send({ error: waitMessage(wait) });
    const found = users.forLogin(parsed.data.name);
    const ok = found
      ? await verifyPassword(parsed.data.password, found.passwordHash)
      : await verifyAgainstNothing(parsed.data.password);
    if (!ok || !found) {
      return reply.code(401).send({ error: 'That name and password don’t match.' });
    }
    limiter.succeeded(keys);
    return signIn(req, reply, deps, found.profile);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) sessions.end(req.sessionToken);
    reply.header('Set-Cookie', SessionStore.clearCookie());
    return { ok: true };
  });

  app.put('/api/me', async (req, reply): Promise<Profile | void> => {
    const parsed = meChanges.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad request' });
    const me = req.user!;
    const { defaultKind, currentPassword, newPassword } = parsed.data;
    try {
      if (newPassword !== undefined) {
        // Limited like signing in, so a borrowed session can't be used to
        // guess the real password.
        const keys = [`me:${me.id}`];
        const wait = limiter.attempt(keys);
        if (wait > 0) return reply.code(429).send({ error: waitMessage(wait) });
        const found = users.forLogin(me.name);
        if (!found || !currentPassword || !(await verifyPassword(currentPassword, found.passwordHash))) {
          return reply.code(400).send({ error: 'Your current password isn’t right.' });
        }
        limiter.succeeded(keys);
      }
      const updated = await users.update(me.id, { defaultKind, password: newPassword });
      // A new password signs you out everywhere else.
      if (newPassword !== undefined) sessions.endAllFor(me.id, req.sessionToken ?? undefined);
      return updated;
    } catch (err) {
      return sendError(reply, err);
    }
  });
}
