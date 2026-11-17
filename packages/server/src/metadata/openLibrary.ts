// Book lookups from Open Library. Free, no key, no daily limit worth worrying
// about. A backup source: weaker on typos than Audible or Google, but it keeps
// search working when either of those is down or over its limit.
import type { Book } from '@lectern/shared';
import { getJson, type FetchFn } from '../http.js';

export interface OpenLibraryBook extends Book {
  openLibraryKey: string;
}

const FIELDS = 'key,title,subtitle,author_name,first_publish_year,isbn,cover_i,series';

export async function searchOpenLibrary(fetchFn: FetchFn, query: string): Promise<OpenLibraryBook[]> {
  const params = new URLSearchParams({ q: query, limit: '20', fields: FIELDS });
  // Shorter timeout: Open Library can be slow, and search shouldn't wait on a backup.
  const json = await getJson(fetchFn, `https://openlibrary.org/search.json?${params}`, { timeoutMs: 6_000 });
  return parseOpenLibrary(json);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : [];

export function parseOpenLibrary(json: unknown): OpenLibraryBook[] {
  if (!isObj(json) || !Array.isArray(json.docs)) return [];
  const books: OpenLibraryBook[] = [];
  for (const doc of json.docs) {
    if (!isObj(doc)) continue;
    const key = str(doc.key);
    const title = str(doc.title);
    if (!key || !title) continue;

    const isbns = strings(doc.isbn);
    // Open Library sometimes gives series as "Name ; 2" or "Name #2".
    const seriesText = strings(doc.series)[0];
    const seriesMatch = seriesText ? /^(.*?)(?:\s*[;#,]\s*(?:book\s*)?(\d+(?:\.\d+)?))?\s*$/i.exec(seriesText) : null;
    const coverId = typeof doc.cover_i === 'number' ? doc.cover_i : undefined;

    books.push({
      openLibraryKey: key,
      title,
      subtitle: str(doc.subtitle),
      authors: strings(doc.author_name),
      isbn: isbns.find((i) => i.length === 13) ?? isbns[0],
      publishedYear: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : undefined,
      series: seriesMatch?.[1]
        ? [seriesMatch[2] ? { name: seriesMatch[1].trim(), number: seriesMatch[2] } : { name: seriesMatch[1].trim() }]
        : undefined,
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : undefined,
    });
  }
  return books;
}
