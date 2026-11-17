// Lectern's entry point: read settings, open the database, start serving.
import { createRequire } from 'node:module';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  const app = await buildApp({ config, db, version });

  // Shut down cleanly when Docker stops the container.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      app.log.info(`${signal} received, shutting down`);
      await app.close();
      db.close();
      process.exit(0);
    });
  }

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
