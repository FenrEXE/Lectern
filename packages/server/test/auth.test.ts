import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { AuthorResponse, MeResponse, Profile, SeriesResponse, StatusResponse } from '@lectern/shared';
import { buildApp } from '../src/app.js';
import { LoginLimiter } from '../src/auth/guard.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { openMemoryDb } from '../src/db.js';
import { fetchCover, isAllowedCover } from '../src/coverFetch.js';
import { fakeFetch, json } from './fixtures.js';
import { ADMIN, cookieFrom, testApp, tmpDir } from './helpers.js';

describe('passwords', () => {
  it('hashes with a salt and checks correctly', async () => {
    const a = await hashPassword('secret-one');
    const b = await hashPassword('secret-one');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('secret-one', a)).toBe(true);
    expect(await verifyPassword('secret-two', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('first run and signing in', () => {
  it('asks for setup until the first (admin) profile exists, then never again', async () => {
    const app = await buildApp({ env: { DATA_DIR: tmpDir('d') }, db: openMemoryDb(), version: '0', webDir: tmpDir('w'), logger: false, watchDownloads: false, setupCode: 'ABCD-EFGH' });
    expect((await app.inject({ url: '/api/auth/me' })).json<MeResponse>()).toEqual({ setupNeeded: true, me: null });

    // Without the code from the log, nobody can claim a fresh install.
    const noCode = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: ADMIN });
    expect(noCode.statusCode).toBe(400);
    const wrongCode = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...ADMIN, code: 'ABCD-EFGX' } });
    expect(wrongCode.statusCode).toBe(403);

    // Case, spaces and the dash don't matter. The sign-in page choice is saved.
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { ...ADMIN, code: 'abcd efgh', showProfiles: false },
    });
    expect(setup.json<MeResponse>().me).toMatchObject({ name: 'Admin', role: 'admin' });
    const cookie = String(setup.headers['set-cookie']);
    expect(cookie).toMatch(/lectern_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
    expect((await app.inject({ url: '/api/auth/profiles' })).json().profiles).toEqual([]);

    const again = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name: 'Sneaky', password: 'password1', code: 'ABCD-EFGH' } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('limits guesses at the setup code', async () => {
    const app = await buildApp({ env: { DATA_DIR: tmpDir('d') }, db: openMemoryDb(), version: '0', webDir: tmpDir('w'), logger: false, watchDownloads: false, setupCode: 'ABCD-EFGH' });
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...ADMIN, code: `WRONG-00${i}` } });
    }
    const right = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...ADMIN, code: 'ABCD-EFGH' } });
    expect(right.statusCode).toBe(429);
    await app.close();
  });

  it('gives the first admin the library folders set in the environment', async () => {
    const lib = tmpDir('lib');
    const { app, asAdmin } = await testApp({ LIBRARY_AUDIOBOOKS_DIR: lib, ABS_AUDIOBOOKS_LIBRARY_ID: 'abs-1' });
    const me = (await asAdmin({ url: '/api/auth/me' })).json<MeResponse>().me!;
    expect(me.libraries.audiobook).toEqual({ dir: lib, absLibraryId: 'abs-1' });
    await app.close();
  });

  it('signs in with the right password only, and signs out', async () => {
    const { app } = await testApp();
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'admin', password: 'nope-nope' } });
    expect(wrong.statusCode).toBe(401);
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'ghost', password: 'nope-nope' } });
    expect(unknown.json().error).toBe(wrong.json().error); // doesn't reveal which names exist

    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'ADMIN', password: ADMIN.password } });
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok);
    expect((await app.inject({ url: '/api/status', headers: { cookie } })).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ url: '/api/status', headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });

  it('pauses sign-in after five wrong passwords', async () => {
    let now = 1_000_000;
    const limiter = new LoginLimiter(() => now);
    const keys = ['ip:1.2.3.4', 'name:admin'];
    for (let i = 0; i < 5; i++) expect(limiter.attempt(keys)).toBe(0);
    expect(limiter.attempt(keys)).toBe(15 * 60 * 1000); // the sixth waits, and isn't counted
    // The same name from another address still works: a stranger can't
    // lock someone out of their own profile with five bad guesses...
    expect(limiter.waitFor(['ip:5.6.7.8', 'name:admin'])).toBe(0);
    // ...but many guesses at one name from all over do pause it.
    for (let i = 0; i < 15; i++) limiter.attempt([`ip:10.0.0.${i}`, 'name:admin']);
    expect(limiter.waitFor(['ip:5.6.7.8', 'name:admin'])).toBeGreaterThan(0);
    now += 15 * 60 * 1000;
    expect(limiter.waitFor(keys)).toBe(0);
    // A right password clears the count.
    limiter.attempt(['ip:9.9.9.9']);
    limiter.succeeded(['ip:9.9.9.9']);
    expect(limiter.waitFor(['ip:9.9.9.9'])).toBe(0);

    const { app } = await testApp();
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Admin', password: 'wrong-wrong' } });
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    expect(locked.statusCode).toBe(429);
    await app.close();
  });

  it('counts guesses sent all at once', async () => {
    const { app } = await testApp();
    const wrong = { method: 'POST' as const, url: '/api/auth/login', payload: { name: 'Admin', password: 'wrong-wrong' } };
    const results = await Promise.all(Array.from({ length: 12 }, () => app.inject(wrong)));
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(7);
    await app.close();
  });

  it('blocks requests from other websites', async () => {
    const { app, admin } = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: admin, origin: 'https://evil.example', host: 'lectern.local:8787' },
    });
    expect(res.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: admin, origin: 'http://lectern.local:8787', host: 'lectern.local:8787' },
    });
    expect(same.statusCode).toBe(200);
    await app.close();
  });

  it('can hide profile names on the sign-in page', async () => {
    const { app, asAdmin } = await testApp();
    expect((await app.inject({ url: '/api/auth/profiles' })).json().profiles).toHaveLength(1);
    await asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { options: { showProfiles: false } } });
    expect((await app.inject({ url: '/api/auth/profiles' })).json().profiles).toEqual([]);
    await app.close();
  });
});

describe('profiles and the admin panel', () => {
  async function withMember() {
    const t = await testApp();
    const created = await t.asAdmin({ method: 'POST', url: '/api/admin/users', payload: { name: 'Reader', password: 'reader-pass' } });
    const member = created.json<Profile>();
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Reader', password: 'reader-pass' } });
    return { ...t, member, asMember: t.as(cookieFrom(login)), memberCookie: cookieFrom(login) };
  }

  it('keeps members out of admin routes', async () => {
    const { app, asMember } = await withMember();
    expect((await asMember({ url: '/api/admin/settings' })).statusCode).toBe(403);
    expect((await asMember({ url: '/api/admin/users' })).statusCode).toBe(403);

    // Addresses written in disguise reach the same routes, and get the same checks.
    const sneaky = { name: 'Sneaky', password: 'password1', role: 'admin' };
    expect((await app.inject({ method: 'POST', url: '/%61pi/admin/users', payload: sneaky })).statusCode).toBe(401);
    expect((await app.inject({ url: '/%61pi/admin/folders?path=/' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/%61pi/status' })).statusCode).toBe(401);
    expect((await asMember({ url: '/api/%61dmin/settings' })).statusCode).toBe(403);
    expect((await asMember({ method: 'POST', url: '/api/%61dmin/users', payload: sneaky })).statusCode).toBe(403);
    await app.close();
  });

  it('refuses short passwords and duplicate names', async () => {
    const { app, asAdmin } = await testApp();
    const short = await asAdmin({ method: 'POST', url: '/api/admin/users', payload: { name: 'X', password: 'short' } });
    expect(short.json().error).toMatch(/8 characters/);
    const dupe = await asAdmin({ method: 'POST', url: '/api/admin/users', payload: { name: 'admin', password: 'long-enough' } });
    expect(dupe.statusCode).toBe(409);
    await app.close();
  });

  it('never removes or demotes the last admin', async () => {
    const { app, asAdmin, member } = await withMember();
    const me = (await asAdmin({ url: '/api/auth/me' })).json<MeResponse>().me!;
    const demote = await asAdmin({ method: 'PUT', url: `/api/admin/users/${me.id}`, payload: { role: 'member' } });
    expect(demote.json().error).toMatch(/at least one admin/);
    expect((await asAdmin({ method: 'DELETE', url: `/api/admin/users/${me.id}` })).statusCode).toBe(400);
    expect((await asAdmin({ method: 'DELETE', url: `/api/admin/users/${member.id}` })).statusCode).toBe(200);
    await app.close();
  });

  it('checks library folders exist before saving them', async () => {
    const { app, asAdmin, member } = await withMember();
    const missing = await asAdmin({
      method: 'PUT',
      url: `/api/admin/users/${member.id}`,
      payload: { libraries: { audiobook: { dir: '/no/such/folder' } } },
    });
    expect(missing.json().error).toMatch(/can’t find/);
    const lib = tmpDir('lib');
    const ok = await asAdmin({
      method: 'PUT',
      url: `/api/admin/users/${member.id}`,
      payload: { libraries: { audiobook: { dir: lib, absLibraryId: 'abs-2' } } },
    });
    expect(ok.json<Profile>().libraries.audiobook).toEqual({ dir: lib, absLibraryId: 'abs-2' });
    await app.close();
  });

  it('gives each profile its own Add to Library setting', async () => {
    const { app, asAdmin, asMember, member } = await withMember();
    await asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { values: { MAM_ID: 'cookie-x', QB_URL: 'http://qb:8080' } } });
    await asAdmin({ method: 'PUT', url: `/api/admin/users/${member.id}`, payload: { libraries: { ebook: { dir: tmpDir('eb') } } } });
    expect((await asMember({ url: '/api/status' })).json<StatusResponse>().canAdd).toEqual({ audiobook: false, ebook: true });
    expect((await asAdmin({ url: '/api/status' })).json<StatusResponse>().canAdd).toEqual({ audiobook: false, ebook: false });
    await app.close();
  });

  it('lets you change your own password, which signs out your other sessions', async () => {
    const { app, asMember, memberCookie } = await withMember();
    const second = cookieFrom(
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Reader', password: 'reader-pass' } }),
    );
    const wrong = await asMember({ method: 'PUT', url: '/api/me', payload: { currentPassword: 'nope', newPassword: 'new-password' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await asMember({
      method: 'PUT',
      url: '/api/me',
      payload: { currentPassword: 'reader-pass', newPassword: 'new-password', defaultKind: 'ebook' },
    });
    expect(ok.json<Profile>().defaultKind).toBe('ebook');
    expect((await app.inject({ url: '/api/status', headers: { cookie: memberCookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/status', headers: { cookie: second } })).statusCode).toBe(401);
    await app.close();
  });

  it('only shows you your own downloads (admins can see everyone’s)', async () => {
    const { app, db, asAdmin, asMember, member } = await withMember();
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO requests (kind, status, book_json, torrent_id, torrent_title, user_id, created_at, updated_at)
       VALUES ('audiobook', 'done', '{"title":"B","authors":[]}', '1', 't', ?, ?, ?)`,
    );
    insert.run(member.id, now, now);
    insert.run(1, now, now);
    expect((await asMember({ url: '/api/requests' })).json()).toHaveLength(1);
    expect((await asAdmin({ url: '/api/requests' })).json()).toHaveLength(1);
    const all = (await asAdmin({ url: '/api/requests?all=1' })).json();
    expect(all).toHaveLength(2);
    expect(all.map((r: { userName: string }) => r.userName).sort()).toEqual(['Admin', 'Reader']);
    expect((await asMember({ url: '/api/requests?all=1' })).json()).toHaveLength(1);
    // Retrying someone else's request isn't allowed.
    const adminsRequest = all.find((r: { userName: string }) => r.userName === 'Admin');
    expect((await asMember({ method: 'POST', url: `/api/requests/${adminsRequest.id}/retry` })).statusCode).toBe(404);
    await app.close();
  });
});

describe('connection settings', () => {
  it('saves settings over the environment, never shows secrets, and applies them live', async () => {
    const { app, asAdmin } = await testApp({ QB_URL: 'http://from-env:8080', ABS_API_KEY: 'env-secret-key-1234' });
    let view = (await asAdmin({ url: '/api/admin/settings' })).json();
    const byKey = (k: string) => view.settings.find((s: { key: string }) => s.key === k);
    expect(byKey('QB_URL')).toMatchObject({ value: 'http://from-env:8080', source: 'environment' });
    expect(byKey('ABS_API_KEY')).toMatchObject({ value: null, isSet: true, secret: true, hint: '…1234' });
    expect(JSON.stringify(view)).not.toContain('env-secret-key');

    view = (
      await asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { values: { QB_URL: 'http://saved:8080', MAM_ID: 'mam_id=abc; x=y' } } })
    ).json();
    expect(byKey('QB_URL')).toMatchObject({ value: 'http://saved:8080', source: 'saved' });
    expect((await asAdmin({ url: '/api/status' })).json<StatusResponse>().services.mam).toBe('configured');

    const bad = await asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { values: { QB_URL: 'not a url' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/QB_URL/);

    view = (await asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { values: { QB_URL: null } } })).json();
    expect(byKey('QB_URL')).toMatchObject({ value: 'http://from-env:8080', source: 'environment' });
    await app.close();
  });

  it('needs the password or key typed again to change an address, and keeps the VPN check out of reach', async () => {
    const { app, asAdmin } = await testApp({
      QB_URL: 'http://qb:8080',
      QB_PASS: 'qb-password',
      ABS_URL: 'http://abs',
      ABS_API_KEY: 'env-secret-key-1234',
      MAM_REQUIRE_INTERFACE: 'wg0',
    });
    const save = (values: Record<string, string | null>) =>
      asAdmin({ method: 'PUT', url: '/api/admin/settings', payload: { values } });

    const moved = await save({ ABS_URL: 'http://elsewhere' });
    expect(moved.statusCode).toBe(400);
    expect(moved.json().error).toMatch(/API key again/);
    expect((await save({ ABS_URL: 'http://elsewhere', ABS_API_KEY: null })).statusCode).toBe(400); // the env key would go there
    expect((await save({ ABS_URL: 'http://elsewhere', ABS_API_KEY: 'new-key-5678' })).statusCode).toBe(200);
    expect((await save({ ABS_URL: null, ABS_API_KEY: null })).statusCode).toBe(200); // back to the environment's pair

    expect((await save({ QB_URL: 'http://qb2:8080' })).json().error).toMatch(/password again/);
    expect((await save({ QB_URL: 'http://qb:8080/' })).statusCode).toBe(200); // same address, just a trailing slash

    expect((await save({ MAM_REQUIRE_INTERFACE: '' })).json().error).toMatch(/Unknown setting/);
    expect((await asAdmin({ url: '/api/admin/settings' })).json().mamInterface).toBe('wg0');
    await app.close();
  });

  it('tests qBittorrent and Audiobookshelf connections', async () => {
    const fetchFn = fakeFetch([
      [/qb:8080\/api\/v2\/auth\/login/, () => new Response('', { headers: { 'Set-Cookie': 'SID=s' } })],
      [/qb:8080\/api\/v2\/app\/version/, () => new Response('v5.0.4')],
      [/abs\/api\/libraries/, () => json({ libraries: [{ id: 'l1', name: 'Main library', mediaType: 'book', folders: [{ fullPath: '/audiobooks' }] }] })],
    ]);
    const { app, asAdmin } = await testApp({ QB_URL: 'http://qb:8080', ABS_URL: 'http://abs', ABS_API_KEY: 'k' }, { fetch: fetchFn });
    expect((await asAdmin({ method: 'POST', url: '/api/admin/test/qbittorrent' })).json()).toEqual({
      ok: true,
      message: 'Signed in to qBittorrent v5.0.4.',
    });
    expect((await asAdmin({ method: 'POST', url: '/api/admin/test/audiobookshelf' })).json().ok).toBe(true);
    expect((await asAdmin({ url: '/api/admin/abs/libraries' })).json()).toEqual([
      { id: 'l1', name: 'Main library', mediaType: 'book', folders: ['/audiobooks'] },
    ]);
    expect((await asAdmin({ method: 'POST', url: '/api/admin/test/mam' })).json()).toMatchObject({ ok: false });
    await app.close();
  });

  it('lists folders for the folder picker', async () => {
    const root = tmpDir('pick');
    fs.mkdirSync(`${root}/Audiobooks`);
    fs.mkdirSync(`${root}/.hidden`);
    const { app, asAdmin } = await testApp();
    const res = (await asAdmin({ url: `/api/admin/folders?path=${encodeURIComponent(root)}` })).json();
    expect(res).toMatchObject({ path: root, folders: ['Audiobooks'], writable: true });
    await app.close();
  });
});

describe('author and series pages', () => {
  const product = (asin: string, title: string, series?: [string, string], year = 2010, author = 'Brandon Sanderson') => ({
    asin,
    title,
    authors: [{ name: author }],
    series: series ? [{ title: series[0], sequence: series[1] }] : [],
    release_date: `${year}-01-01`,
  });
  const audible = {
    products: [
      product('A2', 'The Well of Ascension', ['Mistborn', '2'], 2007),
      product('A1', 'The Final Empire', ['Mistborn', '1'], 2006),
      product('A1D', 'The Final Empire (Dramatized Adaptation)', ['Mistborn', '1'], 2020),
      product('S1', 'The Way of Kings', ['The Stormlight Archive', '1'], 2010),
      product('E1', 'Elantris', undefined, 2005),
      product('W1', 'Warbreaker', undefined, 2009),
      product('X1', 'Someone Else’s Book', ['Mistborn', '9'], 2012, 'Another Writer'),
    ],
  };
  const fetchFn = () =>
    fakeFetch([
      [/api\.audible\.com/, () => json(audible)],
      [/googleapis\.com/, () => json({ items: [] })],
    ]);

  it('groups an author’s books by series in reading order, standalones newest first', async () => {
    const f = fetchFn();
    const { app, asAdmin } = await testApp({}, { fetch: f });
    const res = (await asAdmin({ url: '/api/author?name=Brandon%20Sanderson&kind=audiobook' })).json<AuthorResponse>();
    expect(res.series.map((s) => s.name)).toEqual(['Mistborn', 'The Stormlight Archive']);
    expect(res.series[0]!.books.map((b) => b.title)).toEqual(['The Final Empire', 'The Well of Ascension']);
    expect(res.standalone.map((b) => b.title)).toEqual(['Warbreaker', 'Elantris']);
    // Asked Audible by author, never MAM.
    expect(f.calls.some((c) => c.url.includes('author=Brandon+Sanderson'))).toBe(true);
    expect(f.calls.some((c) => c.url.includes('myanonamouse'))).toBe(false);
    await app.close();
  });

  it('lists a series in order', async () => {
    const { app, asAdmin } = await testApp({}, { fetch: fetchFn() });
    const res = (
      await asAdmin({ url: '/api/series?name=Mistborn&author=Brandon%20Sanderson&kind=audiobook' })
    ).json<SeriesResponse>();
    expect(res.books.map((b) => `${b.series![0]!.number} ${b.title}`)).toEqual(['1 The Final Empire', '2 The Well of Ascension']);
    await app.close();
  });
});

describe('covers', () => {
  it('only fetches from known cover sites', () => {
    expect(isAllowedCover('https://m.media-amazon.com/images/I/x.jpg')).toBe(true);
    expect(isAllowedCover('https://covers.openlibrary.org/b/id/1-M.jpg')).toBe(true);
    expect(isAllowedCover('http://m.media-amazon.com/x.jpg')).toBe(false);
    expect(isAllowedCover('https://evil.example/x.jpg')).toBe(false);
    expect(isAllowedCover('https://m.media-amazon.com.evil.example/x.jpg')).toBe(false);
  });

  it('checks every redirect when fetching a cover', async () => {
    const f = fakeFetch([
      [/moved-inside/, () => new Response(null, { status: 302, headers: { Location: 'http://192.168.1.1/admin' } })],
      [/moved-ok/, () => new Response(null, { status: 301, headers: { Location: 'https://ia800.us.archive.org/x.jpg' } })],
      [/archive\.org/, () => new Response('img', { headers: { 'Content-Type': 'image/jpeg' } })],
    ]);
    await expect(fetchCover(f, 'https://m.media-amazon.com/images/I/moved-inside.jpg', 1e6)).rejects.toThrow(/not an allowed/);
    expect((await fetchCover(f, 'https://covers.openlibrary.org/b/id/moved-ok.jpg', 1e6)).contentType).toBe('image/jpeg');
    await expect(fetchCover(f, 'https://evil.example/x.jpg', 1e6)).rejects.toThrow(/not an allowed/);
  });

  it('shrinks a cover to WebP once and serves it from disk after', async () => {
    const png = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#7a3b1d' } }).png().toBuffer();
    const f = fakeFetch([[/m\.media-amazon\.com/, () => new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })]]);
    const { app, asAdmin } = await testApp({}, { fetch: f });
    const url = `/api/cover?u=${encodeURIComponent('https://m.media-amazon.com/images/I/x.jpg')}&w=300`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    const first = await asAdmin({ url });
    expect(first.headers['content-type']).toBe('image/webp');
    expect(first.headers['cache-control']).toMatch(/max-age=31536000/);
    expect((await sharp(first.rawPayload).metadata()).width).toBe(300);
    await asAdmin({ url });
    expect(f.calls).toHaveLength(1);
    expect((await asAdmin({ url: '/api/cover?u=https://evil.example/x.jpg' })).statusCode).toBe(400);
    await app.close();
  });
});
