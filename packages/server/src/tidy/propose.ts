// Tidy up, step 1: for one book already in Audiobookshelf, work out what its
// details should be and which ones differ. Pure functions, no network.
//
// Rules that keep this safe:
//  - only ever *set* a field from the matched book; never blank one out;
//  - the year is only filled in when it's missing;
//  - a cover is only added when the book has none (an existing cover is left alone);
//  - a match is "fix" only when it's clearly the same book; anything less
//    certain is "unsure" and isn't selected unless the admin ticks it.
import {
  authorKey,
  normalizeText,
  sameAuthor,
  titleSimilarity,
  type Book,
  type SeriesPosition,
  type TidyBook,
  type TidyChange,
  type TidyStatus,
} from '@lectern/shared';

const CLEAR_TITLE = 0.9;
const LIKELY_TITLE = 0.7;

/** Title without "(Unabridged)", "[Dramatized]" and similar extras. */
export const cleanTitle = (title: string): string => title.replace(/\s*[([].*?[)\]]/g, '').trim() || title;

export function toTidyBook(b: Book): TidyBook {
  return {
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    narrators: b.narrators ?? [],
    series: b.series ?? [],
    asin: b.asin,
    isbn: b.isbn,
    publishedYear: b.publishedYear,
    hasCover: !!b.coverUrl,
    coverUrl: b.coverUrl,
  };
}

const titleScore = (current: TidyBook, found: Book): number =>
  Math.max(
    titleSimilarity(cleanTitle(current.title), found.title),
    titleSimilarity(cleanTitle(current.title), [found.title, found.subtitle].filter(Boolean).join(' ')),
  );

const authorsMatch = (current: TidyBook, found: Book): boolean =>
  current.authors.length === 0 || current.authors.some((a) => found.authors.some((b) => sameAuthor(a, b) || titleSimilarity(a, b) >= 0.85));

/** The best of several candidates, and how sure Lectern is. */
export function chooseMatch(current: TidyBook, candidates: Book[]): { book?: Book; status: TidyStatus; reason?: string } {
  let best: { book: Book; title: number; author: boolean } | undefined;
  for (const book of candidates) {
    const title = titleScore(current, book);
    const author = authorsMatch(current, book);
    const better = !best || Number(author) - Number(best.author) > 0 || (author === best.author && title > best.title);
    if (better) best = { book, title, author };
  }
  if (!best || best.title < LIKELY_TITLE) return { status: 'not-found', reason: 'No book with a close enough title on Audible.' };
  if (!best.author) return { book: best.book, status: 'unsure', reason: 'Title matches, but the author is different.' };
  if (best.title < CLEAR_TITLE) return { book: best.book, status: 'unsure', reason: 'Probably this book, but the title differs a little.' };
  return { book: best.book, status: 'fix' };
}

/** A book found by the ASIN Audiobookshelf already had: trusted, unless it's plainly another book. */
export function checkAsinMatch(current: TidyBook, found: Book): { status: TidyStatus; reason?: string } {
  if (titleScore(current, found) >= 0.5 || authorsMatch(current, found)) return { status: 'fix' };
  return { status: 'unsure', reason: 'The ASIN in Audiobookshelf points to a book with a different title and author.' };
}

const seriesText = (s: SeriesPosition[]): string => s.map((x) => (x.number ? `${x.name} #${x.number}` : x.name)).join(', ') || '—';
const listText = (names: string[]): string => names.join(', ') || '—';
const sameNumber = (a?: string, b?: string): boolean =>
  (a === undefined && b === undefined) || (a !== undefined && b !== undefined && Number(a) === Number(b) && !Number.isNaN(Number(a))) || a === b;
const sameSeries = (a: SeriesPosition[], b: SeriesPosition[]): boolean =>
  !!a[0] && !!b[0] && normalizeText(a[0].name) === normalizeText(b[0].name) && sameNumber(a[0].number, b[0].number);
const sameNames = (a: string[], b: string[]): boolean =>
  a.map(authorKey).sort().join('|') === b.map(authorKey).sort().join('|');

/** What would change, field by field. Only fields the match actually has. */
export function diff(current: TidyBook, proposed: TidyBook): TidyChange[] {
  const changes: TidyChange[] = [];
  if (proposed.title && normalizeText(proposed.title) !== normalizeText(current.title)) {
    changes.push({ field: 'title', from: current.title || '—', to: proposed.title });
  }
  if (proposed.authors.length && !sameNames(current.authors, proposed.authors)) {
    changes.push({ field: 'authors', from: listText(current.authors), to: listText(proposed.authors) });
  }
  if (proposed.series.length && !sameSeries(current.series, proposed.series)) {
    changes.push({ field: 'series', from: seriesText(current.series), to: seriesText(proposed.series) });
  }
  if (proposed.narrators.length && !sameNames(current.narrators, proposed.narrators)) {
    changes.push({ field: 'narrators', from: listText(current.narrators), to: listText(proposed.narrators) });
  }
  if (proposed.asin && proposed.asin !== current.asin) {
    changes.push({ field: 'asin', from: current.asin ?? '—', to: proposed.asin });
  }
  if (proposed.publishedYear && !current.publishedYear) {
    changes.push({ field: 'publishedYear', from: '—', to: String(proposed.publishedYear) });
  }
  if (proposed.coverUrl && !current.hasCover) {
    changes.push({ field: 'cover', from: 'none', to: 'from Audible' });
  }
  return changes;
}
