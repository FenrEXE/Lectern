import { describe, expect, it } from 'vitest';
import type { DetailsResponse, SearchResponse } from '@lectern/shared';
import { DAILY_SEARCH_LIMIT } from '../src/mam/client.js';
import { audibleMistborn, fakeFetch, json, mamFinalEmpire } from './fixtures.js';
import { testApp } from './helpers.js';

const torrent = (id: string, title: string, author: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  author_info: JSON.stringify({ 1: author }),
  filetype: 'm4b',
  size: '1000',
  seeders: '10',
  leechers: '0',
  lang_code: 'ENG',
  ...extra,
});

/** An app whose MAM answers with `data`, counting how often MAM is asked. */
async function appWithMam(data: unknown[], extra: Array<[RegExp, () => Response]> = []) {
  const f = fakeFetch([
    [/loadSearchJSONbasic/, () => json({ data })],
    ...extra,
    [/api\.audible\.com/, () => json({ products: [] })],
    [/googleapis\.com/, () => json({ items: [] })],
    [/openlibrary\.org/, () => json({ docs: [] })],
  ]);
  const t = await testApp({ MAM_ID: 'cookie' }, { fetch: f, mam: { sleep: async () => {}, interfaceNames: () => [] } });
  const search = async (q: string) =>
    (await t.asAdmin({ url: `/api/search?${new URLSearchParams({ q, kind: 'audiobook' })}` })).json<SearchResponse>();
  const mamCalls = () => f.calls.filter((c) => c.url.includes('myanonamouse')).length;
  return { ...t, f, search, mamCalls };
}

describe('MAM-first search', () => {
  it('asks MAM once, groups uploads of the same book, and puts packs after single books', async () => {
    const { app, search, mamCalls } = await appWithMam(mamFinalEmpire.data);
    const res = await search('sanderson');
    expect(res.status).toBe('ok');
    expect(mamCalls()).toBe(1);
    // 1001 (m4b) and 1002 (mp3) are the same book: one entry, m4b first.
    expect(res.books.map((b) => b.title)).toEqual(['The Final Empire', 'The Well of Ascension', 'Mistborn Era One']);
    expect(res.books[0]!.torrents.map((t) => t.id)).toEqual(['1001', '1002']);
    expect(res.books[2]!.pack).toBe(true);
    expect(res.books[0]!.series).toEqual([{ name: 'Mistborn', number: '1' }]); // MAM's "01"
    expect(res.books[2]!.series![0]!.number).toBe('1-3'); // "01-03"

    // The same search again (any profile) is answered from the cache.
    await search('Sanderson');
    expect(mamCalls()).toBe(1);
    await app.close();
  });

  it('shows a series’ packs among its books when the series itself was searched', async () => {
    const { app, search } = await appWithMam(mamFinalEmpire.data);
    const res = await search('mistborn');
    expect(res.books.map((b) => b.title)).toContain('Mistborn Era One');
    // Book 1 before book 2.
    const singles = res.books.filter((b) => !b.pack).map((b) => b.title);
    expect(singles).toEqual(['The Final Empire', 'The Well of Ascension']);
    await app.close();
  });

  it('keeps different books with the same title apart', async () => {
    const { app, search } = await appWithMam([
      torrent('1', 'Legacy', 'Alice Writer'),
      torrent('2', 'Legacy', 'Bob Author'),
      torrent('3', 'Legacy (Unabridged)', 'Alice Writer', { filetype: 'mp3' }),
    ]);
    const res = await search('legacy');
    expect(res.books.map((b) => `${b.title} / ${b.authors[0]}`)).toEqual(['Legacy / Alice Writer', 'Legacy / Bob Author']);
    expect(res.books[0]!.torrents).toHaveLength(2);
    await app.close();
  });

  it('moves narrator-only matches to "others" and hides other languages', async () => {
    const { app, search } = await appWithMam([
      torrent('1', 'Thor & Dragon', 'R. Knight'),
      torrent('2', 'A Different Book', 'Someone Else', { narrator_info: JSON.stringify({ 9: 'Dragon Knight' }) }),
      torrent('3', 'Thor und Drache', 'R. Knight', { lang_code: 'GER' }),
    ]);
    const res = await search('dragon knight');
    expect(res.books.map((b) => b.title)).toEqual(['Thor & Dragon']);
    expect(res.others.map((b) => b.title)).toEqual(['A Different Book']);
    expect(res.hiddenLanguages).toBe(1);
    await app.close();
  });

  it('suggests a spelling when MAM finds nothing, without asking MAM again', async () => {
    const { app, search, mamCalls } = await appWithMam([], [[/api\.audible\.com/, () => json(audibleMistborn)]]);
    const res = await search('final empyre');
    expect(res.books).toEqual([]);
    expect(res.didYouMean).toBeTruthy();
    expect(res.didYouMean).not.toBe('final empyre');
    expect(mamCalls()).toBe(1);
    await app.close();
  });

  it('stops at the daily limit, but cached searches still work', async () => {
    const { app, db, search, mamCalls } = await appWithMam(mamFinalEmpire.data);
    await search('sanderson');
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(String(DAILY_SEARCH_LIMIT), `mam.searches.${today}`);
    expect((await search('mistborn')).status).toBe('daily-limit');
    expect((await search('sanderson')).status).toBe('ok'); // from the cache
    expect(mamCalls()).toBe(1);
    await app.close();
  });

  it('adds covers from Audible only when it’s clearly the same book', async () => {
    const { app, asAdmin, f } = await appWithMam([], [[/api\.audible\.com/, () => json(audibleMistborn)]]);
    const details = (
      await asAdmin({
        method: 'POST',
        url: '/api/books/details',
        payload: {
          kind: 'audiobook',
          books: [
            { id: 'a', title: 'The Final Empire', author: 'Brandon Sanderson' },
            { id: 'b', title: 'The Final Empire', author: 'Somebody Else' },
          ],
        },
      })
    ).json<DetailsResponse>();
    expect(details.a?.coverUrl).toMatch(/final-empire/);
    expect(details.a?.asin).toBe('B002UZMLXM');
    expect(details.b).toBeUndefined(); // same title, wrong author: no cover rather than the wrong one
    expect(f.calls.some((c) => c.url.includes('myanonamouse'))).toBe(false);
    await app.close();
  });
});
