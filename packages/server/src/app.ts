// Builds the Fastify app: API routes, plus the built web app when it exists.
// Kept separate from index.ts so tests can build the app without starting a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { HOUR, pruneCache } from './cache.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { FetchFn } from './http.js';
import { MamClient, type MamClientOptions } from './mam/client.js';
import { healthRoutes } from './routes/health.js';
import { searchRoutes } from './routes/search.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// packages/server/dist → packages/web/dist (the same in Docker and locally)
const DEFAULT_WEB_DIR = path.resolve(here, '../../web/dist');

export interface AppOptions {
  config: Config;
  db: Db;
  version: string;
  /** Where the built web app lives. Defaults to packages/web/dist. */
  webDir?: string;
  logger?: boolean;
  /** Replaceable for tests. Defaults to the real fetch. */
  fetch?: FetchFn;
  /** Extra MAM client options, for tests (fake clock, interfaces...). */
  mam?: Partial<MamClientOptions>;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: opts.config.logLevel },
  });
  const fetchFn = opts.fetch ?? fetch;

  const mam = new MamClient({
    db: opts.db,
    config: opts.config,
    fetch: fetchFn,
    log: app.log,
    ...opts.mam,
  });

  healthRoutes(app, opts.config, mam, opts.version);
  searchRoutes(app, { db: opts.db, config: opts.config, fetch: fetchFn, mam });

  // Clear out expired cache entries hourly.
  const pruner = setInterval(() => pruneCache(opts.db), HOUR);
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
