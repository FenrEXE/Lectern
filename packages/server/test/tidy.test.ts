import { describe, expect, it } from 'vitest';
import type { TidyRunResponse } from '@lectern/shared';
import { parseAbsItem } from '../src/audiobookshelf/client.js';
import { chooseBySeries, chooseMatch, cleanTitle, diff, finalProposal, seriesFromTitle, seriesHint } from '../src/tidy/propose.js';
import { metadataFor } from '../src/tidy/service.js';
import { json } from './fixtures.js';
import { testApp } from './helpers.js';

const audibleProduct = (asin: string, title: string, author: string, series?: [string, string], extra: Record<string, unknown> = {}) => ({
  asin,
  title,
  language: 'english',
  authors: [{ name: author, asin: `A_${author.replace(/\W/g, '')}` }],
  narrators: [{ name: 'Michael Kramer' }],
  series: series ? [{ title: series[0], sequence: series[1] }] : [],
  release_date: '2006-07-17',
  product_images: { '500': `https://m.media-amazon.com/images/I/${asin}.jpg` },
  ...extra,
});

/** A tiny pretend Audiobookshelf (one library) and Audible, recording every change. */
function fakeServices() {
  type Meta = { title: string; authors: Array<{ name: string }>; narrators: string[]; series: Array<{ name: string; sequence: string | null }>; asin?: string | null; publishedYear?: string | null };
  const books: Record<string, { meta: Meta; coverPath: string | null; relPath: string }> = {
    li_1: { meta: { title: 'The Final Empire (Unabridged)', authors: [{ name: 'Brandon Sanderson' }], narrators: [], series: [], asin: null }, coverPath: null, relPath: 'Sanderson/TFE' },
    li_2: { meta: { title: 'The Well of Ascension', authors: [{ name: 'Brandon Sanderson' }], narrators: ['Michael Kramer'], series: [{ name: 'Mistborn', sequence: '2' }], asin: 'B002V0QUOC', publishedYear: '2007' }, coverPath: '/metadata/c.jpg', relPath: 'Sanderson/WoA' },
    li_3: { meta: { title: 'Totally Unknown Book', authors: [{ name: 'Nobody' }], narrators: [], series: [] }, coverPath: null, relPath: 'x' },
  };
  const changes: Array<{ method: string; path: string; body?: unknown }> = [];
  const item = (id: string) => ({
    id,
    relPath: books[id]!.relPath,
    isMissing: false,
    media: { coverPath: books[id]!.coverPath, metadata: { ...books[id]!.meta } },
  });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.hostname === 'abs') {
      if (url.pathname === '/api/libraries') return json({ libraries: [{ id: 'lib1', name: 'Audiobooks', mediaType: 'book', folders: [] }] });
      if (url.pathname === '/api/libraries/lib1/items') return json({ results: Object.keys(books).map(item), total: 3 });
      const m = /^\/api\/items\/(li_\d)(\/media|\/cover)?$/.exec(url.pathname);
      if (m) {
        const id = m[1]!;
        if (method !== 'GET') changes.push({ method, path: url.pathname, body });
        if (!m[2]) return json(item(id));
        if (m[2] === '/media') Object.assign(books[id]!.meta, body.metadata);
        if (m[2] === '/cover') books[id]!.coverPath = method === 'DELETE' ? null : '/metadata/new.jpg';
        return json({ success: true });
      }
    }
    if (url.hostname === 'api.audible.com') {
      if (url.pathname.endsWith('/B002V0QUOC')) return json({ product: audibleProduct('B002V0QUOC', 'The Well of Ascension', 'Brandon Sanderson', ['Mistborn', '2'], { release_date: '2007-08-21' }) });
      const title = url.searchParams.get('title') ?? '';
      if (/final empire/i.test(title)) {
        return json({ products: [audibleProduct('B002UZMLXM', 'The Final Empire', 'Brandon Sanderson', ['Mistborn', '1'])] });
      }
      return json({ products: [] });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { books, changes, fetchFn };
}

describe('Tidy up', () => {
  it('reads Audiobookshelf’s short and full item shapes', () => {
    expect(parseAbsItem({ id: 'a', media: { metadata: { title: 'X', authorName: 'A One, B Two', seriesName: 'Mistborn #1, Era One #1.5' } } })!.book).toMatchObject({
      authors: ['A One', 'B Two'],
      series: [{ name: 'Mistborn', number: '1' }, { name: 'Era One', number: '1.5' }],
      hasCover: false,
    });
  });

  it('only proposes what the match has, never blanks, keeps existing covers and years', () => {
    const current = { title: 'TFE', authors: ['Brandon Sanderson'], narrators: ['Someone'], series: [], hasCover: true, publishedYear: 2009 };
    const proposed = { title: 'TFE', authors: ['Brandon Sanderson'], narrators: [], series: [{ name: 'Mistborn', number: '1' }], hasCover: true, coverUrl: 'https://x', publishedYear: 2006 };
    expect(diff(current, proposed).map((c) => c.field)).toEqual(['series']);
    // "01" and "1" are the same number.
    expect(diff({ ...current, series: [{ name: 'Mistborn', number: '01' }] }, proposed)).toEqual([]);
  });

  it('keeps series names as they are, and only fixes a missing or wrong number', () => {
    const tidy = (title: string, series: Array<{ name: string; number?: string }>, narrators: string[] = []) => ({
      title,
      authors: ['Rachel Bach'],
      narrators,
      series,
      hasCover: true,
    });
    // Audible says "Paradox Series #2"; Audiobookshelf has "Paradox": same series.
    const current = tidy("Honor's Knight: Paradox Series, Book 2 (Unabridged)", [{ name: 'Paradox' }]);
    const audible = { title: "Honor's Knight", authors: ['Rachel Bach'], series: [{ name: 'Paradox Series', number: '2' }] };
    const match = chooseMatch(current, [audible]);
    expect(match.status).toBe('fix');
    const proposed = finalProposal(current, { ...tidy("Honor's Knight", audible.series), narrators: ['Emily Ellet'] });
    expect(diff(current, proposed)).toEqual([
      { field: 'title', from: "Honor's Knight: Paradox Series, Book 2 (Unabridged)", to: "Honor's Knight" },
      { field: 'series', from: 'Paradox', to: 'Paradox #2' },
      { field: 'narrators', from: '—', to: 'Emily Ellet' },
    ]);
    // "A Warm Place" vs "Warm Place", same number: nothing to change.
    const seven = tidy('A Warm Place 7', [{ name: 'A Warm Place', number: '7' }]);
    expect(diff(seven, finalProposal(seven, tidy('A Warm Place 7', [{ name: 'Warm Place', number: '7' }])))).toEqual([]);
  });

  it('finds books whose title is just the series and number by that series and number', () => {
    expect(seriesFromTitle('Country Mage, Book 03')).toEqual({ name: 'Country Mage', number: '3' });
    expect(seriesFromTitle('Trailer Park Elves, Book 2')).toEqual({ name: 'Trailer Park Elves', number: '2' });
    expect(seriesFromTitle('Book 03 - Fostering Faust 3 - Fostering Faust Series')).toEqual({ name: 'Fostering Faust', number: '3' });
    expect(seriesFromTitle('The Final Empire')).toBeUndefined();

    const current = { title: 'Country Mage, Book 03', authors: ['Kiel Doe'], narrators: [], series: [], hasCover: true };
    const hint = seriesHint(current)!;
    const audible = [
      { title: 'Country Mage 2', authors: ['Kiel Doe'], series: [{ name: 'Country Mage', number: '2' }] },
      { title: 'Country Mage 3', authors: ['Kiel Doe'], series: [{ name: 'Country Mage', number: '3' }] },
    ];
    expect(chooseMatch(current, audible).status).not.toBe('fix'); // the title alone isn't enough
    const found = chooseBySeries(current, hint, audible);
    expect(found).toMatchObject({ status: 'fix', book: { title: 'Country Mage 3' } });
    expect(chooseBySeries(current, { name: 'Country Mage', number: '9' }, audible).status).toBe('not-found');
  });

  it('never shortens a title by dropping the book’s own name', () => {
    const t = (title: string, series: Array<{ name: string; number?: string }> = []) => ({ title, authors: ['Simon Archer'], narrators: [], series, hasCover: true });
    const mgdf = [{ name: 'Monster Girl Defense Force', number: '2' }];
    expect(diff(t('Monster Girl Defense Force: Skulls and Stones', mgdf), t('Monster Girl Defense Force', mgdf))).toEqual([]);
    expect(diff(t('Power Leveling: Level Up!, Book 4'), t('Level Up! 4')).map((c) => c.field)).toEqual([]);
    // Only filler goes: fine.
    expect(diff(t('Monster Girl Defense Force: Monster Girl Defense Force, Book 1', mgdf), t('Monster Girl Defense Force', mgdf)).map((c) => c.field)).toEqual(['title']);
  });

  it('never takes a book from a different series, and keeps existing narrators', () => {
    const current = {
      title: 'Book 08 - A Warm Place 8 - A Warm Place Series',
      authors: ['Misty Vixen'],
      narrators: ['Gabriel Michael', 'Katana Jones'],
      series: [{ name: 'A Warm Place', number: '8' }],
      hasCover: true,
    };
    expect(cleanTitle(current.title)).toBe('A Warm Place 8');
    const wrong = { title: 'Lakeside Cougars 2', subtitle: 'A Warm Place', authors: ['Misty Vixen'], series: [{ name: 'Lakeside Cougars', number: '2' }] };
    expect(chooseMatch(current, [wrong])).toMatchObject({ status: 'not-found', reason: expect.stringMatching(/different series/) });
    const right = { title: 'A Warm Place 8', authors: ['Misty Vixen'], series: [{ name: 'A Warm Place', number: '8' }] };
    const proposed = finalProposal(current, { ...current, title: right.title, narrators: ['Jessica Threet'], series: right.series });
    expect(diff(current, proposed).map((c) => c.field)).toEqual(['title']); // narrators kept
  });

  it('calls a match with a different author "unsure", not "fix"', () => {
    const current = { title: 'Legacy', authors: ['Alice Writer'], narrators: [], series: [], hasCover: false };
    const other = { title: 'Legacy', authors: ['Bob Author'] };
    expect(chooseMatch(current, [other]).status).toBe('unsure');
    expect(chooseMatch(current, [{ title: 'Something Else', authors: ['Alice Writer'] }]).status).toBe('not-found');
  });

  it('scans without changing anything, applies only the picked books, and undoes them', async () => {
    const svc = fakeServices();
    const { app, asAdmin } = await testApp({ ABS_URL: 'http://abs', ABS_API_KEY: 'k' }, { fetch: svc.fetchFn, tidy: { sleep: async () => {} } });

    expect((await asAdmin({ method: 'POST', url: '/api/admin/tidy/scan', payload: { libraryId: 'lib1' } })).statusCode).toBe(200);
    await app.tidy.running;
    let res = (await asAdmin({ url: '/api/admin/tidy' })).json<TidyRunResponse>();
    expect(res.run).toMatchObject({ status: 'ready', total: 3, scanned: 3, counts: { fix: 1, ok: 1, 'not-found': 1 } });
    expect(svc.changes).toEqual([]); // a scan changes nothing

    const tfe = res.items.find((i) => i.itemId === 'li_1')!;
    expect(tfe.status).toBe('fix');
    expect(tfe.changes.map((c) => c.field)).toEqual(['title', 'series', 'narrators', 'asin', 'publishedYear', 'cover']);
    // The Well of Ascension: found by its ASIN; only a different year, which isn't changed because one is set.
    const woa = res.items.find((i) => i.itemId === 'li_2')!;
    expect(woa.status).toBe('ok');

    await asAdmin({ method: 'POST', url: `/api/admin/tidy/${res.run!.id}/apply`, payload: { items: [tfe.id] } });
    await app.tidy.running;
    expect(svc.books.li_1!.meta).toMatchObject({ title: 'The Final Empire', series: [{ name: 'Mistborn', sequence: '1' }], asin: 'B002UZMLXM' });
    expect(svc.books.li_1!.coverPath).toBe('/metadata/new.jpg');
    expect(svc.changes.every((c) => c.path.startsWith('/api/items/li_1'))).toBe(true); // nothing else touched

    res = (await asAdmin({ url: '/api/admin/tidy' })).json<TidyRunResponse>();
    expect(res.run!.applied).toBe(1);
    await asAdmin({ method: 'POST', url: `/api/admin/tidy/${res.run!.id}/undo` });
    await app.tidy.running;
    expect(svc.books.li_1!.meta).toMatchObject({ title: 'The Final Empire (Unabridged)', series: [], asin: null, narrators: [] });
    expect(svc.books.li_1!.coverPath).toBeNull();
    await app.close();
  });

  it('is admin only', async () => {
    const { app, as, asAdmin } = await testApp();
    await asAdmin({ method: 'POST', url: '/api/admin/users', payload: { name: 'Reader', password: 'reader-pass' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { name: 'Reader', password: 'reader-pass' } });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await as(cookie)({ url: '/api/admin/tidy' })).statusCode).toBe(403);
    await app.close();
  });

  it('writes empty values back when undoing', () => {
    expect(metadataFor([{ field: 'asin', from: '—', to: 'B1' }], { title: 'x', authors: [], narrators: [], series: [], hasCover: false }, true)).toEqual({
      asin: null,
    });
  });
});
