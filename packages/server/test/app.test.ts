import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '@lectern/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { getSetting, openDb, openMemoryDb, setSetting } from '../src/db.js';

const noWeb = path.join(os.tmpdir(), 'lectern-no-web');

describe('config', () => {
  it('treats blank values as not set and trims trailing slashes', () => {
    const c = loadConfig({ MAM_ID: '', QB_URL: 'http://qb:8080/', ABS_URL: '  ' });
    expect(c.mam.cookie).toBeUndefined();
    expect(c.qbittorrent.url).toBe('http://qb:8080');
    expect(c.audiobookshelf.url).toBeUndefined();
    expect(c.port).toBe(8787);
  });

  it('explains bad values', () => {
    expect(() => loadConfig({ PORT: 'abc', QB_URL: 'qb:8080' })).toThrow(/PORT[\s\S]*QB_URL/);
  });
});

describe('database', () => {
  it('stores and updates settings', () => {
    const db = openMemoryDb();
    setSetting(db, 'mam_id', 'one');
    setSetting(db, 'mam_id', 'two');
    expect(getSetting(db, 'mam_id')).toBe('two');
  });

  it('runs migrations once when reopened', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectern-db-'));
    openDb(dir).close();
    const db = openDb(dir);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
  });
});

describe('GET /api/health', () => {
  it('reports which services are configured, without secrets', async () => {
    const config = loadConfig({ MAM_ID: 'secret-cookie', QB_URL: 'http://qb:8080' });
    const app = await buildApp({ config, db: openMemoryDb(), version: '9.9.9', webDir: noWeb, logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      name: 'Lectern',
      version: '9.9.9',
      services: { mam: 'configured', qbittorrent: 'not-configured', audiobookshelf: 'not-configured' },
    });
    expect(res.body).not.toContain('secret-cookie');
    await app.close();
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const app = await buildApp({ config: loadConfig({}), db: openMemoryDb(), version: '0', webDir: noWeb, logger: false });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('normalizeText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('  The Well of Ascension! ')).toBe('the well of ascension');
    expect(normalizeText('Brontë & Co.')).toBe('bronte and co');
  });
});
