// Covers, descriptions and Audible IDs for books found on MAM, from the book
// info sources (never MAM). Asked only for the books on screen, and each
// answer is kept for 30 days.
//
// A source's answer is only used when it's clearly the same book: the title
// has to be close and the author has to match. Otherwise the book simply has
// no cover, which is better than the wrong one.
import { sameAuthor, titleSimilarity, normalizeText, type Book, type BookDetails, type MediaKind } from '@lectern/shared';
import { cacheGet, cacheSet, HOUR } from '../cache.js';

const DAY = 24 * HOUR;
import { readConfig } from '../config.js';
import { searchAudibleBy } from '../metadata/audible.js';
import { searchGoogleBooks } from '../metadata/googleBooks.js';
import { searchOpenLibrary } from '../metadata/openLibrary.js';
import { isLimitError, isResting, type SuggestDeps } from './suggest.js';

const KEEP_FOR = 30 * DAY;
const SAME_TITLE = 0.7;
const SAME_AUTHOR = 0.6;
/** At most this many books per request, and this many looked up at once. */
export const MAX_DETAILS = 30;
const AT_ONCE = 4;

export interface DetailsWanted {
  id: string;
  title: string;
  author?: string;
}

/** Is this source's book the one found on MAM? */
export function isSameBook(wanted: DetailsWanted, found: Book): boolean {
  const title = Math.max(
    titleSimilarity(wanted.title, found.title),
    titleSimilarity(wanted.title, [found.title, found.subtitle].filter(Boolean).join(' ')),
  );
  if (title < SAME_TITLE) return false;
  if (!wanted.author) return true;
  return found.authors.some((a) => sameAuthor(a, wanted.author!) || titleSimilarity(a, wanted.author!) >= SAME_AUTHOR);
}

const pick = (b: Book): BookDetails => ({
  subtitle: b.subtitle,
  description: b.description,
  asin: b.asin,
  isbn: b.isbn,
  publishedYear: b.publishedYear,
  durationMinutes: b.durationMinutes,
  coverUrl: b.coverUrl,
  narrators: b.narrators?.length ? b.narrators : undefined,
  series: b.series,
  authorIds: b.authorIds,
});

async function lookUp(deps: SuggestDeps, wanted: DetailsWanted, kind: MediaKind): Promise<BookDetails | undefined> {
  const config = readConfig(deps.config);
  const quoted = (s: string) => s.replace(/"/g, '');
  const sources: Array<() => Promise<Book[]>> = [];
  const audible = () => searchAudibleBy(deps.fetch, { title: wanted.title, author: wanted.author }, config.audibleRegion, 10);
  const google = () =>
    searchGoogleBooks(
      deps.fetch,
      `intitle:"${quoted(wanted.title)}"${wanted.author ? ` inauthor:"${quoted(wanted.author)}"` : ''}`,
      config.googleBooksApiKey,
      10,
    );
  const openLibrary = () => searchOpenLibrary(deps.fetch, `${wanted.title} ${wanted.author ?? ''}`.trim());
  const useGoogle = !isResting(deps.db, 'google');
  if (kind === 'audiobook') sources.push(audible, ...(useGoogle ? [google] : []), openLibrary);
  else sources.push(...(useGoogle ? [google] : []), openLibrary, audible);

  let merged: BookDetails | undefined;
  for (const source of sources) {
    let books: Book[];
    try {
      books = await source();
    } catch (err) {
      if (isLimitError(err)) continue;
      deps.log?.warn({ err: (err as Error).message }, 'Book details lookup failed');
      continue;
    }
    const match = books.find((b) => isSameBook(wanted, b));
    if (!match) continue;
    const details = pick(match);
    // Fill gaps from later sources (e.g. Google has no cover for this one).
    merged = merged ? { ...details, ...Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) } : details;
    if (merged.coverUrl && merged.description) break;
  }
  return merged;
}

/** Details for the given books, by id. Books with no confident match are left out. */
export async function bookDetails(deps: SuggestDeps, kind: MediaKind, books: DetailsWanted[]): Promise<Record<string, BookDetails>> {
  const out: Record<string, BookDetails> = {};
  const queue = books.slice(0, MAX_DETAILS);
  const work = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const key = `details:${kind}:${normalizeText(next.title)}|${normalizeText(next.author ?? '')}`;
      const hit = cacheGet<BookDetails | { none: true }>(deps.db, key);
      if (hit) {
        if (!('none' in hit)) out[next.id] = hit;
        continue;
      }
      const found = await lookUp(deps, next, kind);
      cacheSet(deps.db, key, found ?? { none: true }, found ? KEEP_FOR : DAY);
      if (found) out[next.id] = found;
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, work));
  return out;
}
