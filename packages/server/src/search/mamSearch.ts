// Search, MAM first: what you type goes to MAM once, and everything shown is
// a torrent MAM actually has. Other sources only add covers and descriptions
// afterwards (see details.ts), and spelling help when MAM finds nothing.
//
// One search costs at most one MAM request (none when cached), then Lectern
// tidies the answer without asking MAM again:
//   1. drops torrents in other languages (the profile's setting);
//   2. keeps results whose title, author or series match what was typed; ones
//      that only matched another field (usually the narrator) go to "others";
//   3. groups uploads of the same book (m4b, mp3, a second upload...) into one
//      book, best version first;
//   4. orders books: single books before packs (unless you searched a series),
//      closest match first, then by series number, then popularity.
import {
  coverage,
  languageId,
  languageMatches,
  normalizeText,
  sameAuthor,
  titleSimilarity,
  words,
  type FoundBook,
  type MamTorrent,
  type MediaKind,
  type SearchResponse,
} from '@lectern/shared';
import type { MamClient } from '../mam/client.js';
import { MamError, seriesRanges, type ParsedTorrent } from '../mam/parse.js';
import { rankTorrents } from './availability.js';
import { suggestBooks, type SuggestDeps } from './suggest.js';

// How much of what was typed must appear in the title, author or series.
// Fuzzy, so a small typo in a long word still counts.
const MAIN_MATCH = 0.85;
// Two uploads are the same book when their titles are at least this alike
// (and they share an author).
const SAME_TITLE = 0.9;

/** Title without bracketed extras like "(Unabridged)" or "[Dramatized]". */
const cleanTitle = (title: string): string => title.replace(/\s*[([].*?[)\]]/g, '').trim() || title;

/** The text a torrent's title, authors and series make up. */
const mainText = (t: ParsedTorrent): string => [t.title, ...t.authors, ...t.series.map((s) => s.name)].join(' ');

/** Did MAM match on the title, author or series (rather than the narrator or tags)? */
export function matchesMainFields(query: string, t: ParsedTorrent): boolean {
  return coverage(query, mainText(t)) >= MAIN_MATCH;
}

/** How closely a torrent matches what was typed, 0–1. */
export function relevance(query: string, t: ParsedTorrent): number {
  const title = cleanTitle(t.title);
  return Math.max(
    titleSimilarity(query, title),
    titleSimilarity(query, `${title} ${t.authors.join(' ')}`),
    // An author or series search: every book by them is equally relevant.
    0.9 * coverage(query, [...t.authors, ...t.series.map((s) => s.name)].join(' ')),
  );
}

const shareAnAuthor = (a: string[], b: string[]): boolean =>
  a.length === 0 || b.length === 0 || a.some((x) => b.some((y) => sameAuthor(x, y)));

/** Group torrents of the same book. Torrents arrive best first, so each group's first is its best. */
export function groupTorrents(torrents: MamTorrent[]): MamTorrent[][] {
  const groups: MamTorrent[][] = [];
  for (const t of torrents) {
    const group = groups.find(([first]) => {
      if (first!.collection !== t.collection) return false;
      if (!shareAnAuthor(first!.authors, t.authors)) return false;
      // Same series but a different number is a different book, whatever the title says.
      const a = first!.series[0];
      const b = t.series.find((s) => a && titleSimilarity(s.name, a.name) >= 0.8);
      // ("01" and "1" are the same number.)
      if (a?.number && b?.number && JSON.stringify(seriesRanges(a.number)) !== JSON.stringify(seriesRanges(b.number))) return false;
      return titleSimilarity(cleanTitle(first!.title), cleanTitle(t.title)) >= SAME_TITLE;
    });
    if (group) group.push(t);
    else groups.push([t]);
  }
  return groups;
}

/** MAM writes series numbers as "01" or "01-03"; Audiobookshelf and folder names want "1" and "1-3". */
export const tidyNumber = (n?: string): string | undefined => n?.replace(/\b0+(\d)/g, '$1');

function toFoundBook(group: MamTorrent[]): FoundBook {
  const best = group[0]!;
  const series = best.series.map((s) => (s.number ? { ...s, number: tidyNumber(s.number) } : s));
  return {
    id: `mam:${best.id}`,
    title: cleanTitle(best.title),
    authors: best.authors,
    narrators: best.narrators,
    series: series.length ? series : undefined,
    isbn: group.find((t) => t.isbn)?.isbn,
    language: languageId(best.language),
    pack: best.collection,
    torrents: group,
  };
}

const firstNumber = (b: FoundBook): number => seriesRanges(b.series?.[0]?.number)[0]?.[0] ?? Number.POSITIVE_INFINITY;
const seeders = (b: FoundBook): number => b.torrents.reduce((sum, t) => sum + t.seeders, 0);

/** Put the books in a sensible order for this query. */
export function orderBooks(query: string, books: Array<FoundBook & { relevance: number }>): FoundBook[] {
  // Searching a series by name: show its packs alongside the single books.
  const seriesSearch = books.some((b) => b.series?.some((s) => titleSimilarity(query, s.name) >= 0.8));
  const bucket = (r: number) => Math.round(r * 10);
  return [...books]
    .sort(
      (a, b) =>
        (seriesSearch ? 0 : Number(a.pack) - Number(b.pack)) ||
        bucket(b.relevance) - bucket(a.relevance) ||
        (a.series?.[0] && b.series?.[0] && normalizeText(a.series[0].name) === normalizeText(b.series[0].name)
          ? firstNumber(a) - firstNumber(b)
          : 0) ||
        seeders(b) - seeders(a),
    )
    .map(({ relevance: _r, ...book }) => book);
}

export interface SearchOptions {
  /** Lectern's language id, or "any". */
  language: string;
  /**
   * Answer only from the cache, never MAM. Used when a page opens with a
   * search already in its address, so loading a page never contacts MAM.
   */
  cachedOnly?: boolean;
}

export async function searchMam(
  deps: SuggestDeps & { mam: MamClient },
  query: string,
  kind: MediaKind,
  options: SearchOptions,
): Promise<SearchResponse> {
  const empty = { query, kind, books: [], others: [], hiddenLanguages: 0 };
  if (!deps.mam.isConfigured()) {
    return { ...empty, status: 'not-configured', message: 'Connect MAM in Lectern’s settings to search.' };
  }

  let found: ParsedTorrent[];
  if (options.cachedOnly) {
    const hit = deps.mam.cachedSearch(query, kind);
    if (!hit) return { ...empty, status: 'ok', notCached: true };
  }
  try {
    found = await deps.mam.search(query, kind);
  } catch (err) {
    if (err instanceof MamError) return { ...empty, status: err.kind, message: err.message };
    throw err;
  }

  const inLanguage = found.filter((t) => languageMatches(languageId(t.language), options.language));
  const hiddenLanguages = found.length - inLanguage.length;

  // Every torrent belongs to the book it is, so matchScore is simply 1 here;
  // ranking then goes by format, then seeders.
  const ranked = rankTorrents(
    kind,
    inLanguage.map((t) => ({ ...t, matchScore: 1 })),
  );
  const main = ranked.filter((t) => matchesMainFields(query, t));
  const rest = ranked.filter((t) => !matchesMainFields(query, t));

  const build = (torrents: MamTorrent[]) =>
    orderBooks(
      query,
      groupTorrents(torrents).map((g) => ({ ...toFoundBook(g), relevance: Math.max(...g.map((t) => relevance(query, t))) })),
    );

  const books = build(main);
  const others = build(rest);

  // Nothing at all: maybe a typo. Ask Audible/Google (never MAM) for a
  // likely spelling. MAM is only searched again if the person taps it.
  let didYouMean: string | undefined;
  if (found.length === 0) {
    try {
      const s = await suggestBooks(deps, query, kind);
      const top = s.suggestions[0];
      const guess = s.didYouMean ?? (top ? words(cleanTitle(top.title)).join(' ') : undefined);
      if (guess && normalizeText(guess) !== normalizeText(query)) didYouMean = guess;
    } catch {
      didYouMean = undefined;
    }
  }

  return { query, kind, status: 'ok', books, others, hiddenLanguages, ...(didYouMean ? { didYouMean } : {}) };
}
