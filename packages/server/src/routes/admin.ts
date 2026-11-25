// The admin panel's API. Everything here needs an admin (checked by the guard).
//
// GET  /api/admin/settings            connection settings (secrets masked) and options
// PUT  /api/admin/settings            { values?: {KEY: string|null}, options?: {...} }
// POST /api/admin/test/:service       mam | qbittorrent | audiobookshelf | google
// GET  /api/admin/abs/libraries       Audiobookshelf's libraries, to pick one per profile
// GET  /api/admin/folders?path=       folders on the server, to pick a library folder
// GET  /api/admin/users               every profile
// POST /api/admin/users               add a profile
// PUT  /api/admin/users/:id           change a profile (name, password, role, libraries...)
// DELETE /api/admin/users/:id
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { LANGUAGES } from '@lectern/shared';
import type { Profile, ProfileLibrary } from '@lectern/shared';
import type { AbsClient } from '../audiobookshelf/client.js';
import type { SessionStore } from '../auth/sessions.js';
import { UserError, type UserStore } from '../auth/users.js';
import { readConfig, type ConfigSource } from '../config.js';
import { HttpError, type FetchFn } from '../http.js';
import type { MamClient } from '../mam/client.js';
import { MamError } from '../mam/parse.js';
import { searchGoogleBooks } from '../metadata/googleBooks.js';
import type { QbClient } from '../qbittorrent/client.js';
import { SettingsError, type AppOptions, type SettingView, type Settings } from '../settings.js';

/** What the admin panel's Connections tab gets. */
interface AdminSettings {
  settings: SettingView[];
  options: AppOptions;
  /** The VPN interface MAM traffic must use; set only in the environment. */
  mamInterface: string | null;
}

export interface AdminDeps {
  settings: Settings;
  config: ConfigSource;
  users: UserStore;
  sessions: SessionStore;
  mam: MamClient;
  qb: QbClient;
  abs: AbsClient;
  fetch: FetchFn;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

const library = z
  .object({ dir: z.string().max(500).optional(), absLibraryId: z.string().max(100).optional() })
  .optional();
const libraries = z.object({ audiobook: library, ebook: library }).optional();

const newUser = z.object({
  name: z.string().max(40),
  password: z.string().max(200),
  role: z.enum(['admin', 'member']).default('member'),
  defaultKind: z.enum(['audiobook', 'ebook']).default('audiobook'),
  language: z.enum(['any', ...LANGUAGES.map((l) => l.id)] as [string, ...string[]]).optional(),
  libraries,
});

const userChanges = z.object({
  name: z.string().max(40).optional(),
  password: z.string().max(200).optional(),
  role: z.enum(['admin', 'member']).optional(),
  color: z.string().max(7).optional(),
  defaultKind: z.enum(['audiobook', 'ebook']).optional(),
  language: z.enum(['any', ...LANGUAGES.map((l) => l.id)] as [string, ...string[]]).optional(),
  libraries,
});

const settingsChanges = z.object({
  values: z.record(z.string(), z.string().max(4000).nullable()).optional(),
  options: z.object({ showProfiles: z.boolean().optional() }).optional(),
});

/** A library folder must exist, be a folder, and be writable by Lectern. */
async function checkLibraryFolders(libs?: Partial<Record<'audiobook' | 'ebook', ProfileLibrary>>): Promise<void> {
  for (const lib of [libs?.audiobook, libs?.ebook]) {
    const dir = lib?.dir?.trim();
    if (!dir) continue;
    if (!path.isAbsolute(dir)) throw new UserError(`Library folders need a full path (starting with /): ${dir}`);
    const stat = await fs.stat(dir).catch(() => undefined);
    if (!stat?.isDirectory()) throw new UserError(`Lectern can’t find the folder ${dir}.`);
    try {
      await fs.access(dir, fs.constants.W_OK);
    } catch {
      throw new UserError(`Lectern isn’t allowed to write to ${dir}. Check the folder’s owner and permissions.`);
    }
  }
}

const fail = (reply: FastifyReply, err: unknown) => {
  if (err instanceof UserError) return reply.code(err.statusCode).send({ error: err.message });
  if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
  throw err;
};

export function adminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { settings, users, sessions } = deps;

  // ── Connection settings ──

  // The VPN check (MAM_REQUIRE_INTERFACE) is shown but can only be changed in
  // the environment, because it protects the MAM account.
  const view = () => ({
    settings: settings.describe(),
    options: settings.options(),
    mamInterface: readConfig(deps.config).mam.requireInterface ?? null,
  });

  app.get('/api/admin/settings', async (): Promise<AdminSettings> => view());

  app.put('/api/admin/settings', async (req, reply) => {
    const parsed = settingsChanges.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad request' });
    try {
      if (parsed.data.values) settings.update(parsed.data.values);
      if (parsed.data.options) settings.setOptions(parsed.data.options);
      return view();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { service: string } }>('/api/admin/test/:service', async (req, reply): Promise<TestResult | void> => {
    const config = readConfig(deps.config);
    switch (req.params.service) {
      case 'mam':
        if (!deps.mam.isConfigured()) return { ok: false, message: 'No MAM session (mam_id) is set.' };
        try {
          // One small search through MAM's allowed search API (cached for 15 minutes).
          const found = await deps.mam.search('sanderson', 'audiobook');
          return { ok: true, message: `MAM accepted the session (${found.length} results for a test search).` };
        } catch (err) {
          const e = err as MamError;
          return { ok: false, message: e.message };
        }
      case 'qbittorrent':
        try {
          const version = await deps.qb.version();
          return { ok: true, message: `Signed in to qBittorrent ${version.trim()} ${deps.qb.usesApiKey() ? 'with the API key' : 'with the username and password'}.` };
        } catch (err) {
          return { ok: false, message: (err as Error).message };
        }
      case 'audiobookshelf':
        try {
          const libs = await deps.abs.libraries();
          return { ok: true, message: `Connected. This key can see ${libs.length} librar${libs.length === 1 ? 'y' : 'ies'}.` };
        } catch (err) {
          return { ok: false, message: (err as Error).message };
        }
      case 'google':
        try {
          await searchGoogleBooks(deps.fetch, 'mistborn', config.googleBooksApiKey);
          return {
            ok: true,
            message: config.googleBooksApiKey ? 'Google Books answered using your key.' : 'Google Books answered (no key set, so a shared limit applies).',
          };
        } catch (err) {
          const e = err as HttpError;
          const limit = e.status === 429 || (e.status === 403 && /quota|limit/i.test(e.message));
          return { ok: false, message: limit ? 'Google Books says the daily limit is used up.' : e.message };
        }
      default:
        return reply.code(404).send({ error: 'Unknown service.' });
    }
  });

  app.get('/api/admin/abs/libraries', async (_req, reply) => {
    try {
      return await deps.abs.libraries();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  // A simple folder browser, so library folders can be picked rather than typed.
  app.get<{ Querystring: { path?: string } }>('/api/admin/folders', async (req, reply) => {
    const dir = path.resolve(req.query.path || '/');
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const folders = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 500);
      const writable = await fs
        .access(dir, fs.constants.W_OK)
        .then(() => true)
        .catch(() => false);
      return { path: dir, parent: dir === '/' ? null : path.dirname(dir), folders, writable };
    } catch {
      return reply.code(404).send({ error: `Can’t open ${dir}.` });
    }
  });

  // ── Profiles ──

  app.get('/api/admin/users', async (): Promise<Profile[]> => users.list());

  app.post('/api/admin/users', async (req, reply): Promise<Profile | void> => {
    const parsed = newUser.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a name and a password.' });
    try {
      await checkLibraryFolders(parsed.data.libraries);
      return await users.create(parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply): Promise<Profile | void> => {
    const parsed = userChanges.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad request' });
    const id = Number(req.params.id);
    try {
      await checkLibraryFolders(parsed.data.libraries);
      const updated = await users.update(id, parsed.data);
      // A password set by the admin signs that profile out everywhere
      // (except this session, if the admin changed their own).
      if (parsed.data.password !== undefined) {
        sessions.endAllFor(id, id === req.user!.id ? (req.sessionToken ?? undefined) : undefined);
      }
      return updated;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) return reply.code(400).send({ error: 'You can’t remove your own profile.' });
    try {
      users.remove(id);
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
