// Book lookups from Google Books. Works without an API key (with a lower
// daily limit). Best for ebooks: it knows ISBNs, but not series.
import type { Book } from '@lectern/shared';
import { getJson, stripHtml, type FetchFn } from '../http.js';

export interface GoogleBook extends Book {
  googleId: string;
}

export async function searchGoogleBooks(fetchFn: FetchFn, query: string, apiKey?: string): Promise<GoogleBook[]> {
  const params = new URLSearchParams({ q: query, maxResults: '20', printType: 'books' });
  if (apiKey) params.set('key', apiKey);
  const json = await getJson(fetchFn, `https://www.googleapis.com/books/v1/volumes?${params}`);
  return parseGoogleBooks(json);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function parseGoogleBooks(json: unknown): GoogleBook[] {
  if (!isObj(json) || !Array.isArray(json.items)) return [];
  const books: GoogleBook[] = [];
  for (const item of json.items) {
    if (!isObj(item) || !isObj(item.volumeInfo)) continue;
    const v = item.volumeInfo;
    const googleId = str(item.id);
    const title = str(v.title);
    if (!googleId || !title) continue;

    const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers.filter(isObj) : [];
    const isbn =
      str(ids.find((i) => i.type === 'ISBN_13')?.identifier) ?? str(ids.find((i) => i.type === 'ISBN_10')?.identifier);

    const links = isObj(v.imageLinks) ? v.imageLinks : {};
    const cover = str(links.thumbnail) ?? str(links.smallThumbnail);
    const description = str(v.description);
    const date = str(v.publishedDate);

    books.push({
      googleId,
      title,
      subtitle: str(v.subtitle),
      authors: Array.isArray(v.authors) ? v.authors.map(str).filter((a): a is string => !!a) : [],
      description: description ? stripHtml(description) : undefined,
      isbn,
      publishedYear: date ? Number(date.slice(0, 4)) || undefined : undefined,
      // Google serves covers over http with a page-curl effect; ask for https without it.
      coverUrl: cover?.replace(/^http:/, 'https:').replace(/&edge=curl/, ''),
    });
  }
  return books;
}
