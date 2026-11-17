// Step 1 of smart search: work out which book the person meant.
//
// What they typed goes to the book info sources (never to MAM). Their answers
// are merged so the same book from two sources appears once, scored by how
// well they match the typed words (typos allowed), and sorted best first.
import {
  correctQuery,
  coverage,
  normalizeText,
  titleSimilarity,
  type BookSuggestion,
  type MediaKind,
  type MetadataSource,
  type SuggestResponse,
} from '@lectern/shared';
import { cached, HOUR } from '../cache.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { FetchFn } from '../http.js';
import { searchAudible, type AudibleBook } from '../metadata/audible.js';
import { searchGoogleBooks, type GoogleBook } from '../metadata/googleBooks.js';

export interface SuggestDeps {
  db: Db;
  config: Config;
  fetch: FetchFn;
  log?: { warn: (obj: object, msg: string) => void };
}

const MAX_SUGGESTIONS = 12;
// Below this, a result has too little to do with what was typed to show.
const MIN_SCORE = 0.4;

export async function suggestBooks(deps: SuggestDeps, query: string, kind: MediaKind): Promise<SuggestResponse> {
  const key = normalizeText(query);
  const { db, config, fetch } = deps;

  const [audible, google] = await Promise.allSettled([
    cached(db, `meta:audible:${config.audibleRegion}:${key}`, 24 * HOUR, () =>
      searchAudible(fetch, query, config.audibleRegion),
    ),
    cached(db, `meta:google:${key}`, 24 * HOUR, () => searchGoogleBooks(fetch, query, config.googleBooksApiKey)),
  ]);

  const failedSources: MetadataSource[] = [];
  if (audible.status === 'rejected') {
    failedSources.push('audible');
    deps.log?.warn({ err: String(audible.reason) }, 'Audible lookup failed');
  }
  if (google.status === 'rejected') {
    failedSources.push('google');
    deps.log?.warn({ err: String(google.reason) }, 'Google Books lookup failed');
  }

  const candidates = [
    ...toSuggestions(audible.status === 'fulfilled' ? audible.value : [], 'audible', query, kind),
    ...toSuggestions(google.status === 'fulfilled' ? google.value : [], 'google', query, kind),
  ];

  const suggestions = mergeDuplicates(candidates, kind)
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  const top = suggestions[0];
  const didYouMean = top && top.score >= 0.6 ? correctQuery(query, searchableText(top)) : undefined;

  return { query, kind, didYouMean, suggestions, failedSources };
}

/** All the words a person might type to find this book. */
export function searchableText(b: Pick<BookSuggestion, 'title' | 'subtitle' | 'authors' | 'series' | 'narrators'>): string {
  return [b.title, b.subtitle, ...b.authors, ...(b.series ?? []).map((s) => s.name), ...(b.narrators ?? [])]
    .filter(Boolean)
    .join(' ');
}

/** The source whose details we trust most for this kind of book. */
const preferredSource = (kind: MediaKind): MetadataSource => (kind === 'audiobook' ? 'audible' : 'google');

function toSuggestions(
  books: Array<AudibleBook | GoogleBook>,
  source: MetadataSource,
  query: string,
  kind: MediaKind,
): BookSuggestion[] {
  return books.map((book, index) => {
    const { googleId: _g, ...rest } = book as GoogleBook;
    const id = source === 'audible' ? `audible:${(book as AudibleBook).asin}` : `google:${(book as GoogleBook).googleId}`;
    // Mostly how well the words match, plus a little for the source's own ranking
    // and a nudge for the source that suits this kind of book.
    const sourceRank = books.length > 1 ? 1 - index / (books.length - 1) : 1;
    const preferred = source === preferredSource(kind) ? 0.05 : 0;
    const score = Math.min(1, 0.8 * coverage(query, searchableText(rest)) + 0.15 * sourceRank + preferred);
    return { ...rest, id, source, score: Math.round(score * 1000) / 1000 };
  });
}

const surname = (authors: string[]): string => normalizeText(authors[0] ?? '').split(' ').pop() ?? '';

/** True when two suggestions are almost certainly the same book. */
export function sameBook(a: BookSuggestion, b: BookSuggestion): boolean {
  if (a.asin && b.asin) return a.asin === b.asin;
  if (a.isbn && b.isbn && a.isbn === b.isbn) return true;
  if (surname(a.authors) !== surname(b.authors)) return false;
  const full = (s: BookSuggestion) => [s.title, s.subtitle].filter(Boolean).join(' ');
  return titleSimilarity(full(a), full(b)) >= 0.75;
}

/**
 * Collapse duplicates: keep the preferred source's version and fill its gaps
 * (series, ISBN, ASIN, description...) from the other. Keeps the best score.
 */
export function mergeDuplicates(items: BookSuggestion[], kind: MediaKind): BookSuggestion[] {
  const preferred = preferredSource(kind);
  const ordered = [...items].sort(
    (a, b) => Number(b.source === preferred) - Number(a.source === preferred) || b.score - a.score,
  );
  const merged: BookSuggestion[] = [];
  for (const item of ordered) {
    const existing = merged.find((m) => sameBook(m, item));
    if (!existing) {
      merged.push({ ...item });
      continue;
    }
    existing.score = Math.max(existing.score, item.score);
    existing.series ??= item.series;
    existing.isbn ??= item.isbn;
    existing.asin ??= item.asin;
    existing.description ??= item.description;
    existing.narrators ??= item.narrators;
    existing.durationMinutes ??= item.durationMinutes;
    existing.publishedYear ??= item.publishedYear;
    existing.coverUrl ??= item.coverUrl;
  }
  return merged;
}
