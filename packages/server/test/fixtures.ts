// Sample answers shaped like the real services' responses, for offline tests.

export const audibleMistborn = {
  total_results: 3,
  products: [
    {
      asin: 'B002UZMLXM',
      title: 'The Final Empire',
      subtitle: 'Mistborn, Book 1',
      authors: [{ asin: 'B001IGFHW6', name: 'Brandon Sanderson' }],
      narrators: [{ name: 'Michael Kramer' }],
      series: [{ asin: 'B00X', title: 'Mistborn', sequence: '1' }],
      product_images: { '500': 'https://m.media-amazon.com/images/I/final-empire._SL500_.jpg' },
      release_date: '2009-03-02',
      runtime_length_min: 1490,
      publisher_summary: '<p>For a thousand years the ash fell <b>and</b> no flowers bloomed.</p>',
    },
    {
      asin: 'B002V0QUOC',
      title: 'The Well of Ascension',
      subtitle: 'Mistborn, Book 2',
      authors: [{ name: 'Brandon Sanderson' }],
      narrators: [{ name: 'Michael Kramer' }],
      series: [{ title: 'Mistborn', sequence: '2' }],
      product_images: { '500': 'https://m.media-amazon.com/images/I/well._SL500_.jpg' },
      release_date: '2009-03-02',
      runtime_length_min: 1711,
    },
    { asin: 'BROKEN' }, // no title: must be skipped
  ],
};

export const googleMistborn = {
  totalItems: 2,
  items: [
    {
      id: 'g-final-empire',
      volumeInfo: {
        title: 'Mistborn',
        subtitle: 'The Final Empire',
        authors: ['Brandon Sanderson'],
        publishedDate: '2010-04-01',
        description: 'Ash falls from the sky.',
        industryIdentifiers: [
          { type: 'ISBN_10', identifier: '0765360969' },
          { type: 'ISBN_13', identifier: '9780765360960' },
        ],
        imageLinks: { thumbnail: 'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl' },
      },
    },
    {
      id: 'g-hobbit',
      volumeInfo: { title: 'The Hobbit', authors: ['J. R. R. Tolkien'], publishedDate: '1937' },
    },
  ],
};

export const openLibraryMistborn = {
  numFound: 1,
  docs: [
    {
      key: '/works/OL5738148W',
      title: 'The Final Empire',
      author_name: ['Brandon Sanderson'],
      first_publish_year: 2006,
      isbn: ['0765311780', '9780765311788'],
      cover_i: 12345,
      series: ['Mistborn ; 1'],
    },
    { title: 'No key, skipped' },
  ],
};

export const mamFinalEmpire = {
  perpage: 50,
  start: 0,
  data: [
    {
      id: 1001,
      title: 'The Final Empire',
      author_info: '{"77":"Brandon Sanderson"}',
      narrator_info: '{"88":"Michael Kramer"}',
      series_info: '{"99":["Mistborn","1"]}',
      filetype: 'm4b',
      size: '622.9 MiB',
      seeders: 40,
      leechers: 1,
      catname: 'Audiobooks - Fantasy',
      added: '2019-01-01 00:00:00',
      free: 0,
    },
    {
      id: 1002,
      title: 'The Final Empire',
      author_info: '{"77":"Brandon Sanderson"}',
      narrator_info: '{"88":"Michael Kramer"}',
      series_info: '{"99":["Mistborn","1"]}',
      filetype: 'mp3',
      size: '700 MiB',
      seeders: 90,
      leechers: 0,
      catname: 'Audiobooks - Fantasy',
      free: 1,
    },
    {
      id: 1003,
      title: 'The Well of Ascension',
      author_info: '{"77":"Brandon Sanderson"}',
      series_info: '{"99":["Mistborn","2"]}',
      filetype: 'm4b',
      seeders: 30,
      leechers: 0,
    },
  ],
  total: 3,
  found: 3,
};

/** A fake fetch that answers by URL, and records what was asked. */
export function fakeFetch(routes: Array<[RegExp, () => Response | Promise<Response>]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`No fake route for ${url}`);
    return route[1]();
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

export const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
