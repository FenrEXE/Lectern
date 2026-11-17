import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AvailabilityResponse, SuggestResponse } from '@lectern/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db.js';
import { MamClient, readMamCookie } from '../src/mam/client.js';
import { parseSearchResponse, parseSeries } from '../src/mam/parse.js';
import { parseAudible } from '../src/metadata/audible.js';
import { parseGoogleBooks } from '../src/metadata/googleBooks.js';
import { buildQueries, checkAvailability, scoreTorrent } from '../src/search/availability.js';
import { suggestBooks } from '../src/search/suggest.js';
import { audibleMistborn, fakeFetch, googleMistborn, json, mamFinalEmpire } from './fixtures.js';

const noWeb = path.join(os.tmpdir(), 'lectern-no-web');
const finalEmpire = {
  title: 'The Final Empire',
  subtitle: 'Mistborn, Book 1',
  authors: ['Brandon Sanderson'],
  series: [{ name: 'Mistborn', number: '1' }],
};

function metadataFetch() {
  return fakeFetch([
    [/api\.audible\.com/, () => json(audibleMistborn)],
    [/googleapis\.com/, () => json(googleMistborn)],
  ]);
}

// A MAM client with a fake clock, so the 2-second gap doesn't slow tests.
function mamClient(fetchFn: typeof fetch, env: NodeJS.ProcessEnv = { MAM_ID: 'cookie-1' }, db = openMemoryDb()) {
  let clock = 1_000_000;
  const waits: number[] = [];
  const client = new MamClient({
    db,
    config: loadConfig(env),
    fetch: fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    interfaceNames: () => ['lo', 'eth0'],
  });
  return { client, waits, db };
}

describe('metadata parsing', () => {
  it('reads Audible products, skipping broken ones', () => {
    const books = parseAudible(audibleMistborn);
    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      asin: 'B002UZMLXM',
      title: 'The Final Empire',
      authors: ['Brandon Sanderson'],
      narrators: ['Michael Kramer'],
      series: [{ name: 'Mistborn', number: '1' }],
      publishedYear: 2009,
      durationMinutes: 1490,
      description: 'For a thousand years the ash fell and no flowers bloomed.',
    });
  });

  it('reads Google Books volumes, preferring ISBN-13 and https covers', () => {
    const [book] = parseGoogleBooks(googleMistborn);
    expect(book?.isbn).toBe('9780765360960');
    expect(book?.coverUrl).toMatch(/^https:\/\/.*zoom=1$/);
  });

  it('copes with junk', () => {
    expect(parseAudible({ nope: 1 })).toEqual([]);
    expect(parseGoogleBooks(null)).toEqual([]);
  });
});

describe('suggestBooks', () => {
  it('understands a typo-ridden query and merges duplicates', async () => {
    const fetchFn = metadataFetch();
    const res = await suggestBooks(
      { db: openMemoryDb(), config: loadConfig({}), fetch: fetchFn },
      'brandon sandersen mistbron',
      'audiobook',
    );
    expect(res.didYouMean).toBe('brandon sanderson mistborn');
    expect(res.failedSources).toEqual([]);
    // The Final Empire appears once, from Audible, with Google's ISBN merged in.
    const finals = res.suggestions.filter((s) => /final empire/i.test(`${s.title} ${s.subtitle}`));
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ source: 'audible', asin: 'B002UZMLXM', isbn: '9780765360960' });
    // The Hobbit has nothing to do with the query.
    expect(res.suggestions.some((s) => s.title === 'The Hobbit')).toBe(false);
  });

  it('prefers Google for ebooks', async () => {
    const res = await suggestBooks(
      { db: openMemoryDb(), config: loadConfig({}), fetch: metadataFetch() },
      'mistborn final empire',
      'ebook',
    );
    expect(res.suggestions[0]).toMatchObject({ source: 'google', series: [{ name: 'Mistborn', number: '1' }] });
  });

  it('caches lookups and survives a failing source', async () => {
    const db = openMemoryDb();
    const fetchFn = fakeFetch([
      [/api\.audible\.com/, () => json(audibleMistborn)],
      [/googleapis\.com/, () => new Response('nope', { status: 503 })],
    ]);
    const deps = { db, config: loadConfig({}), fetch: fetchFn };
    const first = await suggestBooks(deps, 'mistborn', 'audiobook');
    expect(first.failedSources).toEqual(['google']);
    expect(first.suggestions.length).toBeGreaterThan(0);
    const callsAfterFirst = fetchFn.calls.length;
    await suggestBooks(deps, 'Mistborn!', 'audiobook'); // same words → Audible from cache
    const audibleCalls = fetchFn.calls.filter((c) => c.url.includes('audible')).length;
    expect(audibleCalls).toBe(1);
    expect(fetchFn.calls.length).toBe(callsAfterFirst + 1); // only Google retried
  });
});

describe('MAM parsing', () => {
  it('unpacks authors and series from JSON strings', () => {
    const [t] = parseSearchResponse(mamFinalEmpire);
    expect(t).toMatchObject({
      id: '1001',
      authors: ['Brandon Sanderson'],
      narrators: ['Michael Kramer'],
      series: [{ name: 'Mistborn', number: '1' }],
      format: 'm4b',
      seeders: 40,
      freeleech: false,
    });
    expect(parseSeries('{"1":["Stormlight Archive","2.5"],"2":["Cosmere"]}')).toEqual([
      { name: 'Stormlight Archive', number: '2.5' },
      { name: 'Cosmere' },
    ]);
  });

  it('treats "nothing returned" as no results and session errors as expired', () => {
    expect(parseSearchResponse({ error: 'Nothing returned, out of 0' })).toEqual([]);
    expect(() => parseSearchResponse({ error: 'Invalid session - ASN mismatch' })).toThrow(/session/);
  });

  it('reads a refreshed cookie from Set-Cookie', () => {
    const h = new Headers();
    h.append('Set-Cookie', 'mam_id=new-cookie; path=/; domain=.myanonamouse.net; secure; HttpOnly');
    expect(readMamCookie(h)).toBe('new-cookie');
    expect(readMamCookie(new Headers())).toBeUndefined();
  });
});

describe('MamClient', () => {
  it('spaces requests, caches answers and keeps the refreshed cookie', async () => {
    let n = 0;
    const fetchFn = fakeFetch([
      [
        /myanonamouse/,
        () => json(mamFinalEmpire, { headers: { 'Set-Cookie': `mam_id=cookie-${++n + 1}; path=/` } }),
      ],
    ]);
    const { client, waits } = mamClient(fetchFn);
    await client.search('final empire sanderson', 'audiobook');
    await client.search('mistborn sanderson', 'audiobook');
    await client.search('Final Empire, Sanderson', 'audiobook'); // cached

    expect(fetchFn.calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
    const cookies = fetchFn.calls.map((c) => (c.init?.headers as Record<string, string>).Cookie);
    expect(cookies).toEqual(['mam_id=cookie-1', 'mam_id=cookie-2']);
    const sent = JSON.parse(String(fetchFn.calls[0]?.init?.body));
    expect(sent.tor.main_cat).toEqual(['13']);
  });

  it('lets a newly pasted MAM_ID replace a stored cookie', async () => {
    const fetchFn = fakeFetch([[/myanonamouse/, () => json(mamFinalEmpire, { headers: { 'Set-Cookie': 'mam_id=refreshed' } })]]);
    const first = mamClient(fetchFn, { MAM_ID: 'old' });
    await first.client.search('a b', 'audiobook');
    // Restart with a different MAM_ID: the pasted one must win.
    const second = mamClient(fetchFn, { MAM_ID: 'mam_id=pasted; other=x' }, first.db);
    await second.client.search('c d', 'ebook');
    expect((fetchFn.calls[1]?.init?.headers as Record<string, string>).Cookie).toBe('mam_id=pasted');
  });

  it('refuses to contact MAM when the VPN interface is missing', async () => {
    const fetchFn = fakeFetch([[/myanonamouse/, () => json(mamFinalEmpire)]]);
    const { client } = mamClient(fetchFn, { MAM_ID: 'x', MAM_REQUIRE_INTERFACE: 'wg0' });
    await expect(client.search('x y', 'audiobook')).rejects.toMatchObject({ kind: 'vpn-down' });
    expect(fetchFn.calls).toHaveLength(0);
  });

  it('reports an expired session and keeps the old cookie', async () => {
    const fetchFn = fakeFetch([
      [/myanonamouse/, () => json({ error: 'Invalid session' }, { headers: { 'Set-Cookie': 'mam_id=bad' } })],
    ]);
    const { client } = mamClient(fetchFn);
    await expect(client.search('x y', 'audiobook')).rejects.toMatchObject({ kind: 'session-expired' });
    expect(client.isConfigured()).toBe(true);
  });
});

describe('availability', () => {
  it('builds at most three searches, most specific first', () => {
    expect(buildQueries(finalEmpire)).toEqual(['final empire sanderson', 'mistborn sanderson', 'brandon sanderson']);
    expect(buildQueries({ title: 'Standalone (Unabridged)', authors: [] })).toEqual(['standalone']);
  });

  it('scores the right book above the next one in the series', () => {
    const [m4b, , well] = parseSearchResponse(mamFinalEmpire);
    expect(scoreTorrent(finalEmpire, m4b!)).toBeGreaterThan(0.85);
    expect(scoreTorrent(finalEmpire, well!)).toBeLessThan(0.5);
  });

  it('stops after one search when it finds a strong match, and ranks m4b first', async () => {
    const fetchFn = fakeFetch([[/myanonamouse/, () => json(mamFinalEmpire)]]);
    const { client } = mamClient(fetchFn);
    const res = await checkAvailability(client, finalEmpire, 'audiobook');
    expect(res.status).toBe('ok');
    expect(res.queries).toEqual(['final empire sanderson']);
    expect(fetchFn.calls).toHaveLength(1);
    expect(res.matches.map((t) => t.id)).toEqual(['1001', '1002']);
    expect(res.matches.some((t) => t.id === '1003')).toBe(false);
  });

  it('tries the next search when the first finds nothing good', async () => {
    let call = 0;
    const fetchFn = fakeFetch([
      [/myanonamouse/, () => json(++call === 1 ? { error: 'Nothing returned, out of 0' } : mamFinalEmpire)],
    ]);
    const { client } = mamClient(fetchFn);
    const res = await checkAvailability(client, finalEmpire, 'audiobook');
    expect(res.queries).toEqual(['final empire sanderson', 'mistborn sanderson']);
    expect(res.matches[0]?.id).toBe('1001');
  });

  it('explains why when MAM can’t be used', async () => {
    const { client } = mamClient(fakeFetch([]), {});
    const res = await checkAvailability(client, finalEmpire, 'audiobook');
    expect(res.status).toBe('not-configured');
  });
});

describe('search routes', () => {
  it('GET /api/suggest validates and answers', async () => {
    const app = await buildApp({
      config: loadConfig({}),
      db: openMemoryDb(),
      version: '0',
      webDir: noWeb,
      logger: false,
      fetch: metadataFetch(),
    });
    expect((await app.inject({ url: '/api/suggest?q=a' })).statusCode).toBe(400);
    const res = await app.inject({ url: '/api/suggest?q=sandersen%20mistborn&kind=audiobook' });
    expect(res.statusCode).toBe(200);
    const body = res.json<SuggestResponse>();
    expect(body.suggestions[0]?.title).toBe('The Final Empire');
    await app.close();
  });

  it('POST /api/availability answers without MAM set up', async () => {
    const app = await buildApp({ config: loadConfig({}), db: openMemoryDb(), version: '0', webDir: noWeb, logger: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/availability',
      payload: { kind: 'audiobook', book: finalEmpire },
    });
    expect(res.json<AvailabilityResponse>().status).toBe('not-configured');
    await app.close();
  });
});
