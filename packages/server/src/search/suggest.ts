// Step 1 of smart search: work out which book the person meant.
//
// What they typed goes to the book info sources (never to MAM). Their answers
// are merged so the same book from two sources appears once, scored by how
// well they match the typed words (typos allowed), and sorted best first.
//
// Sources:
//   Audible       best for audiobooks: forgiving of typos, knows series
//   Google Books  best for ebooks: ISBNs, descriptions (has a daily limit)
//   Open Library  backup: always asked for ebooks, and for audiobooks whenever
//                 Google is resting after hitting its limit
import {
  correctQuery,
  coverage,
  normalizeText,
  titleSimilarity,
  type Book,
  type BookSuggestion,
  type MediaKind,
  type MetadataSource,
  type SourceProblem,
  type SuggestResponse,
} from '@lectern/shared';
import { cached, cacheGet, cacheSet, HOUR } from '../cache.js';
import { readConfig, type ConfigSource } from '../config.js';
import type { Db } from '../db.js';
import { HttpError, type FetchFn } from '../http.js';
import { searchAudible } from '../metadata/audible.js';
import { searchGoogleBooks } from '../metadata/googleBooks.js';
import { searchOpenLibrary } from '../metadata/openLibrary.js';

export interface SuggestDeps {
  db: Db;
  config: ConfigSource;
  fetch: FetchFn;
  log?: { warn: (obj: object, msg: string) => void };
}

const MAX_SUGGESTIONS = 12;
// Below this, a result has too little to do with what was typed to show.
const MIN_SCORE = 0.4;
// After a source says "too many requests", leave it alone for this long.
const COOLDOWN = HOUR;

/** Which source's details we trust most, best first, for each kind of book. */
export const SOURCE_ORDER: Record<MediaKind, MetadataSource[]> = {
  audiobook: ['audible', 'google', 'openlibrary'],
  ebook: ['google', 'openlibrary', 'audible'],
};

/** A source's answer: each book with that source's own id for it. */
export type SourceResult = Array<{ sourceId: string; book: Book }>;

class SourceResting extends Error {}

export async function suggestBooks(deps: SuggestDeps, query: string, kind: MediaKind): Promise<SuggestResponse> {
  const key = normalizeText(query);
  const { db, fetch } = deps;
  const config = readConfig(deps.config);

  const lookups: Record<MetadataSource, () => Promise<SourceResult>> = {
    audible: async () =>
      (await searchAudible(fetch, query, config.audibleRegion)).map((b) => ({ sourceId: b.asin, book: b })),
    google: async () =>
      (await searchGoogleBooks(fetch, query, config.googleBooksApiKey)).map(({ googleId, ...b }) => ({
        sourceId: googleId,
        book: b,
      })),
    openlibrary: async () =>
      (await searchOpenLibrary(fetch, query)).map(({ openLibraryKey, ...b }) => ({ sourceId: openLibraryKey, book: b })),
  };
  const cacheKey = (s: MetadataSource) =>
    s === 'audible' ? `meta:v2:audible:${config.audibleRegion}:${key}` : `meta:v2:${s}:${key}`;

  // Open Library is the backup: always for ebooks, and for audiobooks only
  // while Google is resting.
  const sources = SOURCE_ORDER[kind].filter((s) => s !== 'openlibrary' || kind === 'ebook' || isResting(db, 'google'));

  const { results, problems } = await askSources(deps, sources, (s) => ({ cacheKey: cacheKey(s), load: lookups[s] }));
  const candidates = results.flatMap(({ source, items }) => toSuggestions(items, source, query, kind));

  const suggestions = mergeDuplicates(candidates, kind)
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  const top = suggestions[0];
  const didYouMean = top && top.score >= 0.6 ? correctQuery(query, searchableText(top)) : undefined;

  return { query, kind, didYouMean, suggestions, problems };
}

/** True while a source is resting after hitting its limit. */
export const isResting = (db: Db, s: MetadataSource) => cacheGet<boolean>(db, `meta:cooldown:${s}`) === true;

/**
 * Ask several book info sources at once. Each answer is cached for 24 hours;
 * a source that says "too many requests" rests for an hour. One source
 * failing never stops the others.
 */
export async function askSources(
  deps: Pick<SuggestDeps, 'db' | 'log'>,
  sources: MetadataSource[],
  plan: (s: MetadataSource) => { cacheKey: string; load: () => Promise<SourceResult> },
): Promise<{ results: Array<{ source: MetadataSource; items: SourceResult }>; problems: SourceProblem[] }> {
  const { db } = deps;
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const { cacheKey, load } = plan(s);
      // A previous answer for the same words is fine to reuse even while resting.
      const hit = cacheGet<SourceResult>(db, cacheKey);
      if (hit) return hit;
      if (isResting(db, s)) throw new SourceResting();
      return cached(db, cacheKey, 24 * HOUR, load);
    }),
  );

  const results: Array<{ source: MetadataSource; items: SourceResult }> = [];
  const problems: SourceProblem[] = [];
  settled.forEach((result, i) => {
    const source = sources[i]!;
    if (result.status === 'fulfilled') {
      results.push({ source, items: result.value });
      return;
    }
    const err = result.reason;
    const hitLimit = isLimitError(err);
    if (hitLimit) cacheSet(db, `meta:cooldown:${source}`, true, COOLDOWN);
    if (!(err instanceof SourceResting)) deps.log?.warn({ source, err: String(err) }, 'Book lookup failed');
    problems.push({ source, reason: hitLimit || err instanceof SourceResting ? 'limit' : 'error' });
  });
  return { results, problems };
}

/** "Too many requests" or "quota exceeded" (Google uses both 429 and 403). */
export function isLimitError(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  return err.status === 429 || (err.status === 403 && /quota|limit/i.test(err.message));
}

/** All the words a person might type to find this book. */
export function searchableText(b: Pick<BookSuggestion, 'title' | 'subtitle' | 'authors' | 'series' | 'narrators'>): string {
  return [b.title, b.subtitle, ...b.authors, ...(b.series ?? []).map((s) => s.name), ...(b.narrators ?? [])]
    .filter(Boolean)
    .join(' ');
}

function toSuggestions(items: SourceResult, source: MetadataSource, query: string, kind: MediaKind): BookSuggestion[] {
  const preferred = SOURCE_ORDER[kind][0];
  return items.map(({ sourceId, book }, index) => {
    // Mostly how well the words match, plus a little for the source's own ranking
    // and a nudge for the source that suits this kind of book.
    const sourceRank = items.length > 1 ? 1 - index / (items.length - 1) : 1;
    const bonus = source === preferred ? 0.05 : 0;
    const score = Math.min(1, 0.8 * coverage(query, searchableText(book)) + 0.15 * sourceRank + bonus);
    return { ...book, id: `${source}:${sourceId}`, source, score: Math.round(score * 1000) / 1000 };
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
 * Collapse duplicates: keep the most trusted source's version and fill its
 * gaps (series, ISBN, ASIN, description...) from the others. Keeps the best score.
 */
export function mergeDuplicates(items: BookSuggestion[], kind: MediaKind): BookSuggestion[] {
  const order = SOURCE_ORDER[kind];
  const ordered = [...items].sort(
    (a, b) => order.indexOf(a.source) - order.indexOf(b.source) || b.score - a.score,
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
    existing.language ??= item.language;
    existing.authorIds ??= item.authorIds;
  }
  return merged;
}
