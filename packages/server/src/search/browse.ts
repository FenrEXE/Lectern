// Author and series pages. Like search suggestions, these only ask the book
// info sources (Audible, Google Books), never MAM: MAM is only asked when
// someone opens a particular book.
import {
  languageMatches,
  normalizeText,
  sameAuthor,
  titleSimilarity,
  type AuthorResponse,
  type BookSuggestion,
  type MediaKind,
  type MetadataSource,
  type SeriesGroup,
  type SeriesResponse,
} from '@lectern/shared';
import { readConfig } from '../config.js';
import { searchAudibleBy, type AudibleBook } from '../metadata/audible.js';
import { searchGoogleBooks } from '../metadata/googleBooks.js';
import { askSources, mergeDuplicates, SOURCE_ORDER, type SourceResult, type SuggestDeps } from './suggest.js';

/** Audible and Google, in the order that suits this kind of book. */
const browseSources = (kind: MediaKind): MetadataSource[] => SOURCE_ORDER[kind].filter((s) => s !== 'openlibrary');

/** Different recordings of the same book; the plain one is preferred. */
const SPECIAL_EDITION = /dramati[sz]ed|graphic audio|full[- ]cast|abridged|bbc radio|\bsummary\b/i;

/** Who the page is for: a name, plus Audible's ID for that person when known. */
export interface AuthorFilter {
  name: string;
  /** Audible's author ID. Tells apart people with near-identical names. */
  id?: string;
}

/** What a profile wants to see. */
export interface BrowseOptions {
  /** Lectern's language id ("english"), or "any". */
  language: string;
}

/**
 * Is this book by that author? With Audible's author ID, only the ID counts,
 * so "R. Knight" never picks up R.J. Knight or A.R. Knight. Without one (Google
 * Books, or no ID known), the name has to match exactly, apart from case,
 * accents and punctuation.
 */
export const isByAuthor = (author: AuthorFilter) => (b: BookSuggestion): boolean => {
  if (author.id && b.authorIds) return Object.values(b.authorIds).includes(author.id);
  return b.authors.some((a) => sameAuthor(a, author.name));
};

// Audible's author search is loose and returns up to 50 per page. A few pages
// make sure a prolific author's own books aren't crowded out by look-alikes.
const AUDIBLE_PAGES = 3;

async function audibleByAuthor(deps: SuggestDeps, by: { author: string; keywords?: string }, region: string): Promise<AudibleBook[]> {
  const all: AudibleBook[] = [];
  for (let page = 1; page <= AUDIBLE_PAGES; page++) {
    const books = await searchAudibleBy(deps.fetch, by, region, 50, page);
    all.push(...books);
    if (books.length < 50) break;
  }
  return all;
}

/** Turn a source's answer into suggestions, keeping the source's own order as a light score. */
function asSuggestions(items: SourceResult, source: MetadataSource): BookSuggestion[] {
  return items.map(({ sourceId, book }, i) => ({
    ...book,
    id: `${source}:${sourceId}`,
    source,
    score: Math.round((1 - i / Math.max(1, items.length)) * 1000) / 1000,
  }));
}

const seriesNumber = (b: BookSuggestion, i = 0): number => {
  const n = Number(b.series?.[i]?.number);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/**
 * One book per series number: several editions of book 1 become one, with the
 * plain edition preferred over dramatised or abridged ones.
 */
function onePerNumber(books: BookSuggestion[]): BookSuggestion[] {
  const chosen = new Map<string, BookSuggestion>();
  for (const b of books) {
    const key = b.series?.[0]?.number ?? `untitled:${normalizeText(b.title)}`;
    const current = chosen.get(key);
    const special = SPECIAL_EDITION.test(`${b.title} ${b.subtitle ?? ''}`);
    if (!current || (SPECIAL_EDITION.test(`${current.title} ${current.subtitle ?? ''}`) && !special)) {
      chosen.set(key, b);
    }
  }
  return [...chosen.values()];
}

export async function authorBooks(
  deps: SuggestDeps,
  authorFilter: AuthorFilter,
  kind: MediaKind,
  options: BrowseOptions,
): Promise<AuthorResponse> {
  const config = readConfig(deps.config);
  const author = authorFilter.name;
  const key = normalizeText(author);
  const { results, problems } = await askSources(deps, browseSources(kind), (s) =>
    s === 'audible'
      ? {
          cacheKey: `browse:author:audible:v2:${config.audibleRegion}:${key}`,
          load: async () =>
            (await audibleByAuthor(deps, { author }, config.audibleRegion)).map((b) => ({ sourceId: b.asin, book: b })),
        }
      : {
          cacheKey: `browse:author:google:v2:${key}`,
          load: async () =>
            (await searchGoogleBooks(deps.fetch, `inauthor:"${author}"`, config.googleBooksApiKey, 40)).map(
              ({ googleId, ...b }) => ({ sourceId: googleId, book: b }),
            ),
        },
  );

  const books = mergeDuplicates(
    results.flatMap(({ source, items }) => asSuggestions(items, source)),
    kind,
  )
    .filter(isByAuthor(authorFilter))
    .filter((b) => languageMatches(b.language, options.language));

  // Group by series (by name, ignoring case and punctuation).
  const groups = new Map<string, SeriesGroup>();
  const standalone: BookSuggestion[] = [];
  for (const b of books) {
    const s = b.series?.[0];
    if (!s) {
      standalone.push(b);
      continue;
    }
    const k = normalizeText(s.name);
    if (!groups.has(k)) groups.set(k, { name: s.name, books: [] });
    groups.get(k)!.books.push(b);
  }

  const firstYear = (g: SeriesGroup) => Math.min(...g.books.map((b) => b.publishedYear ?? 9999));
  const series = [...groups.values()]
    .map((g) => ({ ...g, books: onePerNumber(g.books).sort((a, b) => seriesNumber(a) - seriesNumber(b)) }))
    .sort((a, b) => firstYear(a) - firstYear(b) || a.name.localeCompare(b.name));

  return {
    author,
    kind,
    series,
    standalone: onePerNumber(standalone).sort((a, b) => (b.publishedYear ?? 0) - (a.publishedYear ?? 0)),
    problems,
  };
}

export async function seriesBooks(
  deps: SuggestDeps,
  seriesName: string,
  authorFilter: AuthorFilter | undefined,
  kind: MediaKind,
  options: BrowseOptions,
): Promise<SeriesResponse> {
  const author = authorFilter?.name;
  const config = readConfig(deps.config);
  const key = `${normalizeText(seriesName)}|${normalizeText(author ?? '')}`;
  const { results, problems } = await askSources(deps, browseSources(kind), (s) =>
    s === 'audible'
      ? {
          cacheKey: `browse:series:audible:v2:${config.audibleRegion}:${key}`,
          load: async () =>
            (await searchAudibleBy(deps.fetch, { keywords: seriesName, author }, config.audibleRegion, 50)).map((b) => ({
              sourceId: b.asin,
              book: b,
            })),
        }
      : {
          cacheKey: `browse:series:google:v2:${key}`,
          load: async () =>
            (
              await searchGoogleBooks(
                deps.fetch,
                author ? `"${seriesName}" inauthor:"${author}"` : `"${seriesName}"`,
                config.googleBooksApiKey,
                40,
              )
            ).map(({ googleId, ...b }) => ({ sourceId: googleId, book: b })),
        },
  );

  const inThisSeries = (b: BookSuggestion) => b.series?.findIndex((s) => titleSimilarity(s.name, seriesName) >= 0.8) ?? -1;

  const books = mergeDuplicates(
    results.flatMap(({ source, items }) => asSuggestions(items, source)),
    kind,
  )
    .filter((b) => inThisSeries(b) !== -1 && (!authorFilter || isByAuthor(authorFilter)(b)))
    .filter((b) => languageMatches(b.language, options.language))
    // Put this series first, so its number is the one shown and used.
    .map((b) => {
      const i = inThisSeries(b);
      const series = [b.series![i]!, ...b.series!.filter((_, j) => j !== i)];
      return { ...b, series };
    });

  return {
    series: books[0]?.series?.[0]?.name ?? seriesName,
    author,
    kind,
    books: onePerNumber(books).sort((a, b) => seriesNumber(a) - seriesNumber(b)),
    problems,
  };
}
