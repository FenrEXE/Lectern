// Tidy up, step 1: for one book already in Audiobookshelf, work out what its
// details should be and which ones differ. Pure functions, no network.
//
// Rules that keep this safe:
//  - only ever *set* a field from the matched book; never blank one out;
//  - the year and narrators are only filled in when they're missing (a
//    different narrator usually means a different recording, not a mistake);
//  - a series is never renamed just because Audible spells it differently
//    ("Paradox" vs "Paradox Series", "A Warm Place" vs "Warm Place"): that
//    would split a series in Audiobookshelf. Only a missing series is added,
//    or a wrong book number corrected;
//  - a match whose series is a different one entirely isn't trusted;
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

/**
 * The title without extras, for looking it up: "(Unabridged)", "[Dramatized]",
 * a leading "Book 08 -", and a trailing ": Paradox Series, Book 2".
 */
export const cleanTitle = (title: string): string =>
  title
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/^\s*book\s*\d+(\.\d+)?\s*[-–:.]\s*/i, '')
    .replace(/\s*[-–:,]\s*[^-–:,]*\b(series|saga|trilogy|duology)\b.*$/i, '')
    .replace(/\s*[,:]\s*book\s*\d+.*$/i, '')
    .trim() || title;

/**
 * A series name with the parts that vary between sources removed, so
 * "Paradox", "Paradox Series" and "The Paradox Saga" all match, as do
 * "A Warm Place" and "Warm Place".
 */
export function seriesKey(name: string): string {
  return normalizeText(name)
    .replace(/^(the|a|an) /, '')
    .replace(/\b(series|saga|trilogy|duology|books|novels|collection)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Both have a series, and they're different series (not just spelled differently). */
const seriesConflict = (a: SeriesPosition[], b: SeriesPosition[]): boolean =>
  a.length > 0 && b.length > 0 && !a.some((x) => b.some((y) => seriesKey(x.name) === seriesKey(y.name)));

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
  // A candidate from a different series is another book, whatever its title.
  const usable = candidates.filter((b) => !seriesConflict(current.series, b.series ?? []));
  for (const book of usable) {
    const title = titleScore(current, book);
    const author = authorsMatch(current, book);
    const better = !best || Number(author) - Number(best.author) > 0 || (author === best.author && title > best.title);
    if (better) best = { book, title, author };
  }
  if (!best || best.title < LIKELY_TITLE) {
    const reason =
      usable.length < candidates.length
        ? 'Audible’s closest matches are in a different series.'
        : 'No book with a close enough title on Audible.';
    return { status: 'not-found', reason };
  }
  if (!best.author) return { book: best.book, status: 'unsure', reason: 'Title matches, but the author is different.' };
  if (best.title < CLEAR_TITLE) return { book: best.book, status: 'unsure', reason: 'Probably this book, but the title differs a little.' };
  return { book: best.book, status: 'fix' };
}

/** A book found by the ASIN Audiobookshelf already had: trusted, unless it's plainly another book. */
export function checkAsinMatch(current: TidyBook, found: Book): { status: TidyStatus; reason?: string } {
  if (seriesConflict(current.series, found.series ?? [])) {
    return { status: 'unsure', reason: 'The ASIN in Audiobookshelf points to a book in a different series.' };
  }
  if (titleScore(current, found) >= 0.5 || authorsMatch(current, found)) return { status: 'fix' };
  return { status: 'unsure', reason: 'The ASIN in Audiobookshelf points to a book with a different title and author.' };
}

const seriesText = (s: SeriesPosition[]): string => s.map((x) => (x.number ? `${x.name} #${x.number}` : x.name)).join(', ') || '—';
const listText = (names: string[]): string => names.join(', ') || '—';
const sameNumber = (a?: string, b?: string): boolean =>
  (a === undefined && b === undefined) || (a !== undefined && b !== undefined && Number(a) === Number(b) && !Number.isNaN(Number(a))) || a === b;
const sameNames = (a: string[], b: string[]): boolean =>
  a.map(authorKey).sort().join('|') === b.map(authorKey).sort().join('|');

// Words a title can drop without losing anything: edition notes and series filler.
const FILLER = new Set(['unabridged', 'abridged', 'book', 'books', 'series', 'saga', 'volume', 'vol', 'part', 'edition', 'novel', 'a', 'an', 'the', 'and', 'of']);

/**
 * Would the new title throw away real words? "Monster Girl Defense Force:
 * Skulls and Stones" → "Monster Girl Defense Force" drops the book's own name,
 * so the title is left alone. Dropping "(Unabridged)", "Paradox Series, Book 2"
 * or a repeated series name is fine.
 */
export function losesWords(current: TidyBook, proposed: TidyBook): boolean {
  const kept = new Set([
    ...normalizeText(proposed.title).split(' '),
    ...normalizeText(proposed.subtitle ?? '').split(' '),
    ...[...current.series, ...proposed.series].flatMap((s) => normalizeText(s.name).split(' ')),
  ]);
  return normalizeText(current.title)
    .split(' ')
    .some((w) => w && !kept.has(w) && !FILLER.has(w) && !/^\d+$/.test(w));
}

/** What would change, field by field. Only fields the match actually has. */
export function diff(current: TidyBook, proposed: TidyBook): TidyChange[] {
  const changes: TidyChange[] = [];
  if (proposed.title && normalizeText(proposed.title) !== normalizeText(current.title) && !losesWords(current, proposed)) {
    changes.push({ field: 'title', from: current.title || '—', to: proposed.title });
  }
  if (proposed.authors.length && !sameNames(current.authors, proposed.authors)) {
    changes.push({ field: 'authors', from: listText(current.authors), to: listText(proposed.authors) });
  }
  const series = seriesChange(current.series, proposed.series);
  if (series) changes.push({ field: 'series', from: seriesText(current.series), to: seriesText(series) });
  if (proposed.narrators.length && current.narrators.length === 0) {
    changes.push({ field: 'narrators', from: '—', to: listText(proposed.narrators) });
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

/**
 * The series a book should end up with, or undefined for "leave it".
 *  - no series yet: take the match's;
 *  - the same series (however it's spelled): keep the name as it is in
 *    Audiobookshelf, and only correct the book number;
 *  - a different series: leave it (the match is probably another book).
 */
export function seriesChange(current: SeriesPosition[], proposed: SeriesPosition[]): SeriesPosition[] | undefined {
  if (proposed.length === 0) return undefined;
  if (current.length === 0) return proposed;
  for (const [i, mine] of current.entries()) {
    const theirs = proposed.find((p) => seriesKey(p.name) === seriesKey(mine.name));
    if (!theirs) continue;
    if (!theirs.number || sameNumber(mine.number, theirs.number)) return undefined;
    return current.map((s, j) => (j === i ? { name: mine.name, number: theirs.number } : s));
  }
  return undefined;
}

/**
 * The match, adjusted to what would actually be written: its series replaced
 * by the result of seriesChange (so the name already in Audiobookshelf is kept).
 */
export function finalProposal(current: TidyBook, proposed: TidyBook): TidyBook {
  return { ...proposed, series: seriesChange(current.series, proposed.series) ?? current.series };
}

/**
 * The series and book number a title spells out, when the title is really just
 * that: "Country Mage, Book 03", "Trailer Park Elves, Book 2",
 * "Book 03 - Fostering Faust 3 - Fostering Faust Series".
 */
export function seriesFromTitle(title: string): SeriesPosition | undefined {
  const t = title.replace(/\s*[([].*?[)\]]/g, '').trim();
  let m = /^(.+?)\s*[,:\-–]\s*book\s*(\d+(?:\.\d+)?)\s*$/i.exec(t);
  if (m) return { name: m[1]!.replace(/\s+series$/i, '').trim(), number: String(Number(m[2])) };
  m = /^book\s*(\d+(?:\.\d+)?)\s*[-–:]\s*.*?[-–:]\s*(.+?)\s+series\s*$/i.exec(t);
  if (m) return { name: m[2]!.trim(), number: String(Number(m[1])) };
  return undefined;
}

/** The series position to look a book up by: its own series, or one spelled out in its title. */
export function seriesHint(book: TidyBook): SeriesPosition | undefined {
  return book.series.find((s) => s.number) ?? seriesFromTitle(book.title);
}

/**
 * Find the book by series and number among an author's (or a series') books on
 * Audible. Used when the title alone finds nothing, e.g. "Country Mage, Book 03".
 */
export function chooseBySeries(current: TidyBook, wanted: SeriesPosition, candidates: Book[]): { book?: Book; status: TidyStatus; reason?: string } {
  const matches = candidates.filter((b) =>
    (b.series ?? []).some((s) => seriesKey(s.name) === seriesKey(wanted.name) && sameNumber(s.number, wanted.number)),
  );
  if (matches.length === 0) return { status: 'not-found', reason: `Couldn’t find ${wanted.name} #${wanted.number} on Audible.` };
  const byAuthor = matches.find((b) => authorsMatch(current, b));
  if (!byAuthor) return { book: matches[0], status: 'unsure', reason: 'Same series and number, but a different author.' };
  return { book: byAuthor, status: 'fix', reason: undefined };
}
