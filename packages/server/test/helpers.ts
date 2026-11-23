import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { buildApp, type AppOptions } from '../src/app.js';
import { openMemoryDb } from '../src/db.js';

export const tmpDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lectern-${name}-`));

export const ADMIN = { name: 'Admin', password: 'correct horse' };
/** The first-run setup code test apps use (real ones are random and logged). */
export const SETUP_CODE = 'TEST-CODE';

/** The cookie a sign-in response set, ready to send back. */
export const cookieFrom = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie'] ?? '').split(';')[0]!;

/**
 * A Lectern app for tests, already set up with an admin profile.
 * `as(cookie)` makes requests as a given signed-in profile.
 */
export async function testApp(env: NodeJS.ProcessEnv = {}, extra: Partial<AppOptions> = {}) {
  const db = extra.db ?? openMemoryDb();
  const app = await buildApp({
    env: { DATA_DIR: tmpDir('data'), ...env },
    db,
    version: '9.9.9',
    webDir: tmpDir('noweb'),
    logger: false,
    watchDownloads: false,
    setupCode: SETUP_CODE,
    ...extra,
  });
  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...ADMIN, code: SETUP_CODE } });
  const admin = cookieFrom(setup);
  const as = (cookie: string) => (opts: InjectOptions) =>
    app.inject({ ...opts, headers: { ...(opts.headers ?? {}), cookie } });
  return { app, db, admin, as, asAdmin: as(admin) };
}
