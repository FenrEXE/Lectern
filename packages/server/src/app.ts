// Builds the Fastify app: API routes, plus the built web app when it exists.
// Kept separate from index.ts so tests can build the app without starting a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { HOUR, pruneCache } from './cache.js';
import { installGuard, LoginLimiter } from './auth/guard.js';
import { SessionStore } from './auth/sessions.js';
import { UserStore } from './auth/users.js';
import type { Db } from './db.js';
import type { FetchFn } from './http.js';
import { AbsClient } from './audiobookshelf/client.js';
import { MamClient, type MamClientOptions } from './mam/client.js';
import { QbClient } from './qbittorrent/client.js';
import { RequestService } from './requests/service.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { browseRoutes } from './routes/browse.js';
import { coverRoutes } from './routes/covers.js';
import { healthRoutes } from './routes/health.js';
import { requestRoutes } from './routes/requests.js';
import { searchRoutes } from './routes/search.js';
import { MamStatsService } from './mam/stats.js';
import { mamStatsRoutes } from './routes/mamStats.js';
import { Settings } from './settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// packages/server/dist → packages/web/dist (the same in Docker and locally)
const DEFAULT_WEB_DIR = path.resolve(here, '../../web/dist');

export interface AppOptions {
  /** Environment variables: the default settings, before anything saved in the admin panel. */
  env: NodeJS.ProcessEnv;
  db: Db;
  version: string;
  /** Where the built web app lives. Defaults to packages/web/dist. */
  webDir?: string;
  logger?: boolean;
  /** Replaceable for tests. Defaults to the real fetch. */
  fetch?: FetchFn;
  /** Extra MAM client options, for tests (fake clock, interfaces...). */
  mam?: Partial<MamClientOptions>;
  /** Watch downloads in the background (off in tests). Default true. */
  watchDownloads?: boolean;
  /** Fixed first-run setup code, for tests. Normally random and printed in the log. */
  setupCode?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const settings = new Settings(opts.db, opts.env);
  // Every service reads settings through this, so admin-panel changes apply straight away.
  const config = settings.config;
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config().logLevel },
    bodyLimit: 1024 * 1024,
    // Read once at startup: a proxy is part of how Lectern is deployed.
    trustProxy: config().trustProxy,
  });
  const fetchFn = opts.fetch ?? fetch;

  const users = new UserStore(opts.db);
  const sessions = new SessionStore(opts.db);
  installGuard(app, sessions, users);

  const mam = new MamClient({ db: opts.db, config, fetch: fetchFn, log: app.log, ...opts.mam });
  const qb = new QbClient(() => config().qbittorrent, fetchFn);
  const abs = new AbsClient(() => config().audiobookshelf, fetchFn);
  const requests = new RequestService({ db: opts.db, config, users, fetch: fetchFn, mam, qb, abs, log: app.log });

  healthRoutes(app, config, mam, requests, opts.version);
  authRoutes(app, { users, sessions, limiter: new LoginLimiter(), settings, config, setupCode: opts.setupCode });
  adminRoutes(app, { settings, config, users, sessions, mam, qb, abs, fetch: fetchFn });
  searchRoutes(app, { db: opts.db, config, fetch: fetchFn, mam });
  browseRoutes(app, { db: opts.db, config, fetch: fetchFn });
  coverRoutes(app, { dataDir: config().dataDir, fetch: fetchFn });
  requestRoutes(app, requests);
  const mamStats = new MamStatsService({ db: opts.db, mam, log: app.log });
  mamStatsRoutes(app, mamStats);

  // Background jobs (off in tests): following downloads, and the hourly MAM account check.
  if (opts.watchDownloads !== false) {
    requests.start();
    mamStats.start();
  }
  app.addHook('onClose', async () => {
    requests.stop();
    mamStats.stop();
  });

  // Clear out expired cache entries and sign-in sessions hourly.
  const pruner = setInterval(() => {
    pruneCache(opts.db);
    sessions.pruneExpired();
  }, HOUR);
  pruner.unref();
  app.addHook('onClose', async () => clearInterval(pruner));

  const webDir = opts.webDir ?? DEFAULT_WEB_DIR;
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir });
    // Single-page app: any non-API address that isn't a file gets index.html,
    // so links like /search?q=... work when opened directly.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.log.warn(`No built web app at ${webDir}; serving the API only.`);
  }

  return app;
}
