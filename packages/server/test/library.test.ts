import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LibraryRequest } from '@lectern/shared';
import { buildApp } from '../src/app.js';
import { AbsClient } from '../src/audiobookshelf/client.js';
import { loadConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db.js';
import { absMetadata, bookFolders, chooseFiles, importBook, safeName } from '../src/library/importer.js';
import { MamClient } from '../src/mam/client.js';
import { QbClient } from '../src/qbittorrent/client.js';
import { RequestService } from '../src/requests/service.js';
import { torrentInfoHash } from '../src/torrent/torrentFile.js';
import { fakeFetch, json } from './fixtures.js';

// ── A tiny bencode writer, to make real .torrent files for tests ──
type B = number | string | Buffer | B[] | { [k: string]: B };
function bencode(v: B): Buffer {
  if (typeof v === 'number') return Buffer.from(`i${v}e`);
  if (typeof v === 'string') return bencode(Buffer.from(v));
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(`${v.length}:`), v]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([Buffer.from('d'), ...keys.flatMap((k) => [bencode(k), bencode(v[k]!)]), Buffer.from('e')]);
}

const info = { name: 'The Final Empire', 'piece length': 16384, pieces: Buffer.alloc(20, 7), length: 1234 };
const torrentFile = bencode({ announce: 'https://tracker.example/announce', info });
const expectedHash = createHash('sha1').update(bencode(info)).digest('hex');

const finalEmpire = {
  title: 'The Final Empire',
  subtitle: 'Mistborn, Book 1',
  authors: ['Brandon Sanderson'],
  narrators: ['Michael Kramer'],
  series: [{ name: 'Mistborn', number: '1' }],
  asin: 'B002UZMLXM',
  publishedYear: 2009,
  coverUrl: 'https://covers.example/final.jpg',
};

const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lectern-${name}-`));

describe('torrent files', () => {
  it('computes the info hash from the exact info bytes', () => {
    expect(torrentInfoHash(torrentFile)).toBe(expectedHash);
  });

  it('rejects things that aren’t torrents', () => {
    expect(() => torrentInfoHash(Buffer.from('<html>Please log in</html>'))).toThrow(/Not a torrent/);
    expect(() => torrentInfoHash(bencode({ announce: 'x' }))).toThrow(/info/);
    expect(() => torrentInfoHash(Buffer.from('d4:info'))).toThrow();
  });
});

describe('qBittorrent client', () => {
  const base = 'http://qb:8080';

  it('logs in with an SID cookie, whatever the reply text', async () => {
    const fetchFn = fakeFetch([
      [/auth\/login/, () => new Response('', { headers: { 'Set-Cookie': 'SID=abc123; HttpOnly; path=/' } })],
      [/app\/version/, () => new Response('v5.0.4')],
    ]);
    const qb = new QbClient({ url: base, username: 'u', password: 'p' }, fetchFn);
    expect(await qb.version()).toBe('v5.0.4');
    const versionCall = fetchFn.calls.find((c) => c.url.includes('version'));
    expect((versionCall?.init?.headers as Record<string, string>).Cookie).toBe('SID=abc123');
  });

  it('works without a cookie when qBittorrent skips logins for local addresses', async () => {
    const fetchFn = fakeFetch([
      [/auth\/login/, () => new Response('Ok.')],
      [/app\/version/, () => new Response('v4.6.2')],
    ]);
    expect(await new QbClient({ url: base }, fetchFn).version()).toBe('v4.6.2');
  });

  it('tells a wrong password apart from a ban and an unreachable server', async () => {
    const wrong = fakeFetch([
      [/auth\/login/, () => new Response('Fails.')],
      [/app\/version/, () => new Response('Forbidden', { status: 403 })],
    ]);
    await expect(new QbClient({ url: base }, wrong).version()).rejects.toMatchObject({ kind: 'bad-login' });

    const banned = fakeFetch([[/auth\/login/, () => new Response('Your IP is banned', { status: 403 })]]);
    await expect(new QbClient({ url: base }, banned).version()).rejects.toMatchObject({ kind: 'banned' });

    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(new QbClient({ url: base }, down).version()).rejects.toMatchObject({ kind: 'unreachable' });
  });

  it('logs in again once when the session expires', async () => {
    let versionCalls = 0;
    const fetchFn = fakeFetch([
      [/auth\/login/, () => new Response('', { headers: { 'Set-Cookie': 'SID=s' } })],
      [/app\/version/, () => (++versionCalls === 1 ? new Response('', { status: 403 }) : new Response('v5'))],
    ]);
    expect(await new QbClient({ url: base }, fetchFn).version()).toBe('v5');
    expect(fetchFn.calls.filter((c) => c.url.includes('login'))).toHaveLength(2);
  });
});

describe('library importer', () => {
  it('builds Author/Series/Book N - Title folders with safe names', () => {
    expect(bookFolders(finalEmpire)).toEqual(['Brandon Sanderson', 'Mistborn', 'Book 1 - The Final Empire']);
    expect(bookFolders({ title: 'Why: A Story?', authors: [] })).toEqual(['Unknown Author', 'Why A Story']);
    expect(safeName('../../etc')).toBe('etc');
  });

  it('keeps only media files and drops the torrent’s own top folder', () => {
    const files = chooseFiles('audiobook', '/dl', ['TFE/01.mp3', 'TFE/02.mp3', 'TFE/info.nfo', 'TFE/cover.jpg']);
    expect(files.map((f) => f.relative)).toEqual(['01.mp3', '02.mp3']);
    expect(files[0]?.source).toBe(path.resolve('/dl/TFE/01.mp3'));
    expect(chooseFiles('ebook', '/dl', ['book.epub'])).toEqual([{ source: path.resolve('/dl/book.epub'), relative: 'book.epub' }]);
    expect(() => chooseFiles('ebook', '/dl', ['../../etc/x.epub'])).toThrow(/Unsafe/);
  });

  it('writes Audiobookshelf’s metadata.json with series and number', () => {
    expect(absMetadata(finalEmpire)).toMatchObject({
      title: 'The Final Empire',
      subtitle: null, // "Mistborn, Book 1" is series info, not a real subtitle
      authors: ['Brandon Sanderson'],
      series: ['Mistborn #1'],
      asin: 'B002UZMLXM',
      publishedYear: '2009',
    });
  });

  it('hardlinks files, writes metadata and cover, and never overwrites', async () => {
    const downloads = tmp('dl');
    const library = tmp('lib');
    fs.mkdirSync(path.join(downloads, 'TFE'));
    fs.writeFileSync(path.join(downloads, 'TFE', 'book.m4b'), 'audio');
    const files = chooseFiles('audiobook', downloads, ['TFE/book.m4b']);
    const fetchFn = fakeFetch([[/covers\.example/, () => new Response(Buffer.from('jpg'), { headers: { 'Content-Type': 'image/jpeg' } })]]);

    const result = await importBook({ fetch: fetchFn, library, book: finalEmpire, files });
    const dir = path.join(library, 'Brandon Sanderson', 'Mistborn', 'Book 1 - The Final Empire');
    expect(result).toMatchObject({ folder: 'Brandon Sanderson/Mistborn/Book 1 - The Final Empire', linked: 1, copied: 0, coverSaved: true });
    // Same file on disk (a hardlink), not a copy.
    expect(fs.statSync(path.join(dir, 'book.m4b')).ino).toBe(fs.statSync(path.join(downloads, 'TFE', 'book.m4b')).ino);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')).series).toEqual(['Mistborn #1']);
    expect(fs.existsSync(path.join(dir, 'cover.jpg'))).toBe(true);

    const again = await importBook({ fetch: fetchFn, library, book: finalEmpire, files });
    expect(again.alreadyThere).toBe(true);
  });
});

describe('Add to Library, start to finish', () => {
  function setup(opts: { mamAnswer?: () => Response } = {}) {
    const downloads = tmp('dl');
    const library = tmp('lib');
    fs.mkdirSync(path.join(downloads, 'TFE'));
    fs.writeFileSync(path.join(downloads, 'TFE', 'book.m4b'), 'audio');

    let progress = 0.4;
    let added = false;
    const fetchFn = fakeFetch([
      [/myanonamouse\.net\/tor\/download/, opts.mamAnswer ?? (() => new Response(new Uint8Array(torrentFile)))],
      [/auth\/login/, () => new Response('', { headers: { 'Set-Cookie': 'SID=s' } })],
      [/createCategory/, () => new Response('', { status: 409 })],
      [/torrents\/add/, () => ((added = true), new Response('Ok.'))],
      [
        /torrents\/info/,
        () =>
          json(
            added
              ? [{ hash: expectedHash, name: 'TFE', progress, state: progress >= 1 ? 'stalledUP' : 'downloading', save_path: downloads, dlspeed: 1, eta: 120 }]
              : [],
          ),
      ],
      [/torrents\/files/, () => json([{ name: 'TFE/book.m4b', size: 5, progress: 1 }, { name: 'TFE/notes.nfo', size: 1, progress: 1 }])],
      [/covers\.example/, () => new Response(Buffer.from('jpg'), { headers: { 'Content-Type': 'image/jpeg' } })],
      [/abs\/api\/libraries\/lib-1\/scan/, () => new Response('OK')],
    ]);
    const config = loadConfig({
      MAM_ID: 'cookie',
      QB_URL: 'http://qb:8080',
      LIBRARY_AUDIOBOOKS_DIR: library,
      ABS_URL: 'http://abs',
      ABS_API_KEY: 'key',
      ABS_AUDIOBOOKS_LIBRARY_ID: 'lib-1',
    });
    const db = openMemoryDb();
    const mam = new MamClient({ db, config, fetch: fetchFn, sleep: async () => {}, interfaceNames: () => ['wg0'] });
    const service = new RequestService({
      db,
      config,
      fetch: fetchFn,
      mam,
      qb: new QbClient(config.qbittorrent, fetchFn),
      abs: new AbsClient(config.audiobookshelf, fetchFn),
      sleep: async () => {},
    });
    return { service, fetchFn, library, finish: () => (progress = 1) };
  }

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  };

  it('sends, follows the download, files the book and asks Audiobookshelf to scan', async () => {
    const { service, fetchFn, library, finish } = setup();
    const created = await service.create({ kind: 'audiobook', book: finalEmpire, torrentId: '1001', torrentTitle: 'The Final Empire' });
    expect(created.status).toBe('sending');
    await until(() => service.get(created.id)?.status === 'downloading');
    expect(service.get(created.id)).toMatchObject({ status: 'downloading', progress: 0.4 });

    // The download link uses the session cookie and never spends a wedge.
    const dl = fetchFn.calls.find((c) => c.url.includes('download.php'));
    expect(dl?.url).toMatch(/download\.php\?tid=1001$/);

    await service.watch();
    expect(service.get(created.id)?.etaSeconds).toBe(120);

    finish();
    await service.watch();
    const done = service.get(created.id) as LibraryRequest;
    expect(done).toMatchObject({ status: 'done', progress: 1, libraryPath: 'Brandon Sanderson/Mistborn/Book 1 - The Final Empire' });
    expect(done.message).toBeUndefined();
    const dir = path.join(library, 'Brandon Sanderson', 'Mistborn', 'Book 1 - The Final Empire');
    expect(fs.readdirSync(dir).sort()).toEqual(['book.m4b', 'cover.jpg', 'metadata.json']);
    expect(fetchFn.calls.some((c) => c.url.includes('/libraries/lib-1/scan'))).toBe(true);

    // Asking for the same torrent again shows the existing request.
    const again = await service.create({ kind: 'audiobook', book: finalEmpire, torrentId: '1001', torrentTitle: 'x' });
    expect(again.id).toBe(created.id);
  });

  it('fails clearly when MAM sends a login page instead of a torrent, and can retry', async () => {
    let call = 0;
    const { service } = setup({
      mamAnswer: () => (++call === 1 ? new Response('<html>Please log in</html>') : new Response(new Uint8Array(torrentFile))),
    });
    const created = await service.create({ kind: 'audiobook', book: finalEmpire, torrentId: '1001', torrentTitle: 'x' });
    await until(() => service.get(created.id)?.status === 'failed');
    expect(service.get(created.id)?.message).toMatch(/fresh mam_id/);

    service.retry(created.id);
    await until(() => service.get(created.id)?.status === 'downloading');
    expect(service.get(created.id)?.status).toBe('downloading');
  });

  it('refuses when no library folder is set for that kind', async () => {
    const { service } = setup();
    await expect(
      service.create({ kind: 'ebook', book: finalEmpire, torrentId: '5', torrentTitle: 'x' }),
    ).rejects.toThrow(/ebook library/);
  });

  it('POST /api/requests validates input', async () => {
    const app = await buildApp({ config: loadConfig({}), db: openMemoryDb(), version: '0', webDir: tmp('noweb'), logger: false, watchDownloads: false });
    const bad = await app.inject({ method: 'POST', url: '/api/requests', payload: { kind: 'audiobook', torrent: { id: 'x' } } });
    expect(bad.statusCode).toBe(400);
    const unset = await app.inject({
      method: 'POST',
      url: '/api/requests',
      payload: { kind: 'audiobook', torrent: { id: '1', title: 't' }, book: { title: 'A', authors: [] } },
    });
    expect(unset.statusCode).toBe(400);
    expect(unset.json().error).toMatch(/library folder/);
    await app.close();
  });
});
