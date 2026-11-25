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
/**
 * The same series, however each source writes it: equal keys, or one name
 * being the other with words added ("Solar Dragons" / "Solar Dragons Need
 * Love, Too!").
 */
export function sameSeries(a: string, b: string): boolean {
  const x = seriesKey(a);
  const y = seriesKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
}

const seriesConflict = (a: SeriesPosition[], b: SeriesPosition[]): boolean =>
  a.length > 0 && b.length > 0 && !a.some((x) => b.some((y) => sameSeries(x.name, y.name)));

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

// Every way of reading the title: whole, and each side of a "Series: Name" split.
const titleScore = (current: TidyBook, found: Book): number =>
  Math.max(
    ...titleVariants(current.title).flatMap((t) => [
      titleSimilarity(t, found.title),
      titleSimilarity(t, [found.title, found.subtitle].filter(Boolean).join(' ')),
      titleSimilarity(t, [...(found.series ?? []).map((s) => s.name), found.title].join(' ')),
    ]),
  );

const authorsMatch = (current: TidyBook, found: Book): boolean =>
  current.authors.length === 0 || current.authors.some((a) => found.authors.some((b) => sameAuthor(a, b) || titleSimilarity(a, b) >= 0.85));

/** The best of several candidates, and how sure Lectern is. */
export interface MatchResult {
  book?: Book;
  status: TidyStatus;
  reason?: string;
  /** Audible puts the book in a different series than Audiobookshelf does. */
  seriesDiffers?: boolean;
}

export function chooseMatch(
  current: TidyBook,
  candidates: Book[],
  /** The book's place in a series, if known (from Audiobookshelf, the title or the folder). */
  position?: Partial<SeriesPosition> | string,
): MatchResult {
  const hint: Partial<SeriesPosition> | undefined =
    typeof position === 'string' ? { number: position } : position ?? current.series.find((s) => s.number) ?? seriesFromTitle(current.title);

  // Another number in the same series is another book (book 1 isn't book 2).
  const wrongNumber = (b: Book): boolean => {
    if (!hint?.number) return false;
    const theirs = (b.series ?? []).filter((s) => s.number && (!hint.name || sameSeries(s.name, hint.name)));
    return theirs.length > 0 && !theirs.some((s) => sameNumber(s.number, hint.number));
  };
  // How well the candidate's own title (not its subtitle or series) matches.
  const ownTitle = (b: Book): number => Math.max(...titleVariants(current.title).map((t) => titleSimilarity(t, b.title)));

  const scored = candidates
    .filter((b) => !wrongNumber(b))
    .map((book) => ({
      book,
      title: titleScore(current, book),
      author: authorsMatch(current, book),
      conflict: seriesConflict(current.series, book.series ?? []),
      own: ownTitle(book),
    }))
    // A different series is fine only when the title itself clearly matches:
    // Audiobookshelf's series may be the thing that's wrong. Otherwise it's
    // another book ("A Warm Place 8" isn't "Lakeside Cougars 2").
    .filter((c) => !c.conflict || c.own >= CLEAR_TITLE);

  let best: (typeof scored)[number] | undefined;
  for (const c of scored) {
    const rank = (x: typeof c) => [Number(x.author), Number(!x.conflict), x.title];
    const [a1, a2, a3] = rank(c);
    const [b1, b2, b3] = best ? rank(best) : [-1, -1, -1];
    if (a1! > b1! || (a1 === b1 && (a2! > b2! || (a2 === b2 && a3! > b3!)))) best = c;
  }
  if (!best || best.title < LIKELY_TITLE) return { status: 'not-found', reason: 'No book with a close enough title on Audible.' };
  if (!best.author) return { book: best.book, status: 'unsure', reason: 'Title matches, but the author is different.' };
  if (best.conflict) {
    return {
      book: best.book,
      status: 'unsure',
      reason: `Audible has this in “${best.book.series?.[0]?.name}”, Audiobookshelf in “${current.series[0]?.name}”. Fixing it uses Audible’s series.`,
      seriesDiffers: true,
    };
  }
  if (best.title < CLEAR_TITLE) return { book: best.book, status: 'unsure', reason: 'Probably this book, but the title differs a little.' };
  return { book: best.book, status: 'fix' };
}

/** A book found by the ASIN Audiobookshelf already had: trusted, unless it's plainly another book. */
export function checkAsinMatch(current: TidyBook, found: Book): Omit<MatchResult, 'book'> {
  if (seriesConflict(current.series, found.series ?? [])) {
    return {
      status: 'unsure',
      reason: `Audible has this ASIN in “${found.series?.[0]?.name}”, Audiobookshelf in “${current.series[0]?.name}”. Fixing it uses Audible’s series.`,
      seriesDiffers: true,
    };
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
    const theirs = proposed.find((p) => sameSeries(p.name, mine.name));
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
export function finalProposal(current: TidyBook, proposed: TidyBook, replaceSeries = false): TidyBook {
  if (replaceSeries && proposed.series.length) return proposed;
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
    (b.series ?? []).some((s) => sameSeries(s.name, wanted.name) && sameNumber(s.number, wanted.number)),
  );
  if (matches.length === 0) return { status: 'not-found', reason: `Couldn’t find ${wanted.name} #${wanted.number} on Audible.` };
  const byAuthor = matches.find((b) => authorsMatch(current, b));
  if (!byAuthor) return { book: matches[0], status: 'unsure', reason: 'Same series and number, but a different author.' };
  return { book: byAuthor, status: 'fix', reason: undefined };
}

/**
 * The titles worth searching for. "Monster Girl Defense Force: Skulls and
 * Stones" is often "<series>: <the book's own name>", so the part after the
 * colon (or dash) is tried as well as the whole title.
 */
export function titleVariants(title: string): string[] {
  const whole = cleanTitle(title);
  const variants = [whole];
  const m = /^(.+?)\s*(?::|\s[-–]\s)\s*(.+)$/.exec(title.replace(/\s*[([].*?[)\]]/g, '').trim());
  if (m) {
    const after = cleanTitle(m[2]!);
    if (after && after.split(' ').length >= 1 && !/^book\s*\d/i.test(after)) variants.push(after);
  }
  return [...new Set(variants.filter(Boolean))];
}

/** A book number in the last folder name, e.g. "MGDF Book 2" or "Book 03". */
export function numberFromPath(relPath?: string): string | undefined {
  const last = relPath?.split('/').filter(Boolean).pop();
  const m = last ? /\b(?:book|vol(?:ume)?|#)\s*(\d+(?:\.\d+)?)\b/i.exec(last) : null;
  return m ? String(Number(m[1])) : undefined;
}
