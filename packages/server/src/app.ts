// Builds the Fastify app: API routes, plus the built web app when it exists.
// Kept separate from index.ts so tests can build the app without starting a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { healthRoutes } from './routes/health.js';

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
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: opts.config.logLevel },
  });

  healthRoutes(app, opts.config, opts.version);

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
