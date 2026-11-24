import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db.js';
import { MamClient } from '../src/mam/client.js';
import { parseAccountStats } from '../src/mam/parse.js';
import { MamStatsService, REFRESH_GAP_MS } from '../src/mam/stats.js';
import { fakeFetch, json } from './fixtures.js';
import { testApp, tmpDir } from './helpers.js';

const answer = {
  username: 'reader',
  ratio: 26.7,
  uploaded: '5.125 TiB',
  uploaded_bytes: 5_635_036_489_461,
  downloaded_bytes: 210_957_629_456,
  snatch_summary: { unsat: { name: 'Unsatisfied', count: 12, limit: 150, size: null } },
};

describe('MAM account stats', () => {
  it('reads ratio from byte counts and unsat from either place', () => {
    const s = parseAccountStats(answer);
    expect(s.ratio).toBeCloseTo(26.71, 1);
    expect(s.unsat).toEqual({ count: 12, limit: 150 });
    expect(parseAccountStats({ uploaded_bytes: '10', downloaded_bytes: '0', unsat: { count: '3', limit: '50' } })).toEqual({
      ratio: null, // nothing downloaded yet
      uploadedBytes: 10,
      downloadedBytes: 0,
      unsat: { count: 3, limit: 50 },
    });
    // Only the documented, formatted fields: still works.
    const formatted = parseAccountStats({ uploaded: '2 GiB', downloaded: '1,024 MiB', ratio: '2' });
    expect(formatted).toMatchObject({ uploadedBytes: 2 * 1024 ** 3, downloadedBytes: 1024 ** 3, ratio: 2, unsat: null });
    expect(() => parseAccountStats({ error: 'Not logged in' })).toThrow(/Not logged in/);
  });

  it('asks MAM through the VPN-checked client, saves the answer, and limits manual refreshes', async () => {
    let now = 1_000_000;
    const db = openMemoryDb();
    const fetchFn = fakeFetch([[/jsonLoad\.php\?snatch_summary/, () => json(answer)]]);
    const config = loadConfig({ DATA_DIR: tmpDir('d'), MAM_ID: 'cookie', MAM_REQUIRE_INTERFACE: 'wg0' });
    let vpnUp = true;
    const mam = new MamClient({ db, config, fetch: fetchFn, sleep: async () => {}, now: () => now, interfaceNames: () => (vpnUp ? ['wg0'] : []) });
    const stats = new MamStatsService({ db, mam, now: () => now });

    expect(stats.read().stats).toBeNull(); // reading never asks MAM
    expect(fetchFn.calls).toHaveLength(0);

    await stats.refresh(true);
    expect(stats.read().stats).toMatchObject({ unsat: { count: 12, limit: 150 }, checkedAt: now });
    expect(fetchFn.calls[0]!.init?.headers).toMatchObject({ Cookie: 'mam_id=cookie' });

    now += 60_000;
    await stats.refresh(true); // too soon: not asked again
    expect(fetchFn.calls).toHaveLength(1);

    now += REFRESH_GAP_MS;
    vpnUp = false;
    const res = await stats.refresh(true);
    expect(fetchFn.calls).toHaveLength(1); // the VPN check stopped it
    expect(res.problem).toMatch(/VPN/);
    expect(res.stats?.unsat?.count).toBe(12); // the last good answer is kept
  });

  it('needs sign-in to see the stats', async () => {
    const { app, asAdmin } = await testApp();
    expect((await app.inject({ url: '/api/mam/stats' })).statusCode).toBe(401);
    expect((await asAdmin({ url: '/api/mam/stats' })).json()).toMatchObject({ stats: null });
    await app.close();
  });
});
