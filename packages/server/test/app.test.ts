import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { getSetting, openDb, openMemoryDb, setSetting } from '../src/db.js';


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
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    db.close();
  });
});

describe('health and status', () => {
  it('health is public and says nothing about services', async () => {
    const { app } = await testApp({ MAM_ID: 'secret-cookie' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', name: 'Lectern', version: '9.9.9' });
    await app.close();
  });

  it('status needs sign-in, and reports services without secrets', async () => {
    const { app, asAdmin } = await testApp({ MAM_ID: 'secret-cookie', QB_URL: 'http://qb:8080' });
    expect((await app.inject({ url: '/api/status' })).statusCode).toBe(401);
    const res = await asAdmin({ url: '/api/status' });
    expect(res.json()).toEqual({
      version: '9.9.9',
      services: { mam: 'configured', qbittorrent: 'configured', audiobookshelf: 'not-configured' },
      canAdd: { audiobook: false, ebook: false }, // no library folders set
    });
    expect(res.body).not.toContain('secret-cookie');
    await app.close();
  });

  it('returns JSON 404 for unknown API paths once signed in', async () => {
    const { app, asAdmin } = await testApp();
    expect((await asAdmin({ url: '/api/nope' })).statusCode).toBe(404);
    await app.close();
  });
});
