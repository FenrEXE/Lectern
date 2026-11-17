// Step 2 of smart search: the person picked a book, so find it on MAM.
//
// Up to three searches, from most to least specific:
//   1. title + author surname
//   2. series + author surname
//   3. the author's full name
// Searching stops early as soon as a strong match turns up, so most books cost
// MAM a single request. Every torrent is then scored against the chosen book.
import {
  normalizeText,
  titleSimilarity,
  words,
  type AvailabilityResponse,
  type Book,
  type MamTorrent,
  type MediaKind,
} from '@lectern/shared';
import type { MamClient } from '../mam/client.js';
import { MamError, type ParsedTorrent } from '../mam/parse.js';

const MAX_QUERIES = 3;
const STRONG_MATCH = 0.85;
const GOOD_MATCH = 0.7;
const SHOWN_OTHERS = 10;

const surname = (name?: string): string => normalizeText(name ?? '').split(' ').pop() ?? '';

/**
 * The words worth searching for: drops "(Book 2)", "[Unabridged]" and words
 * like "the", because MAM needs every word to match and torrent titles vary.
 */
const cleanTitle = (title: string): string => words(title.replace(/\s*[([].*?[)\]]/g, '')).join(' ');

/** The MAM searches to try for this book, most specific first. */
export function buildQueries(book: Book): string[] {
  const author = book.authors[0];
  const last = surname(author);
  const queries = [
    [cleanTitle(book.title), last].filter(Boolean).join(' '),
    book.series?.[0] ? [normalizeText(book.series[0].name), last].filter(Boolean).join(' ') : '',
    author ? normalizeText(author) : '',
  ].filter((q) => q.length > 0);
  return [...new Set(queries)].slice(0, MAX_QUERIES);
}

/** How well a torrent matches the chosen book, 0–1. */
export function scoreTorrent(book: Book, t: ParsedTorrent): number {
  const fullTitle = [book.title, book.subtitle].filter(Boolean).join(' ');
  const title = Math.max(titleSimilarity(book.title, t.title), titleSimilarity(fullTitle, t.title));

  const author = book.authors.length && t.authors.length
    ? Math.max(...book.authors.flatMap((a) => t.authors.map((b) => titleSimilarity(a, b))))
    : 0.5; // unknown: neither help nor hurt much

  let score = 0.6 * title + 0.3 * author;

  // Series: the right number is a bonus; the same series but a different
  // number means a different book, which is a big penalty.
  const wanted = book.series?.[0];
  const theirs = wanted && t.series.find((s) => titleSimilarity(s.name, wanted.name) >= 0.7);
  if (wanted && theirs) {
    if (wanted.number && theirs.number && Number(wanted.number) !== Number(theirs.number)) score *= 0.5;
    else score += 0.1;
  } else {
    score += 0.05;
  }
  return Math.round(Math.min(1, score) * 100) / 100;
}

// Preferred formats, best first. Anything else comes after these.
const FORMAT_ORDER: Record<MediaKind, string[]> = {
  audiobook: ['m4b', 'mp3', 'm4a', 'flac', 'ogg', 'opus'],
  ebook: ['epub', 'azw3', 'mobi', 'pdf'],
};

function formatRank(kind: MediaKind, format?: string): number {
  const i = format ? FORMAT_ORDER[kind].indexOf(format) : -1;
  return i === -1 ? 99 : i;
}

/** Best first: match (in 0.05 steps, so near-ties fall through), then format, then seeders. */
export function rankTorrents(kind: MediaKind, torrents: MamTorrent[]): MamTorrent[] {
  const bucket = (s: number) => Math.round(s * 20);
  return [...torrents].sort(
    (a, b) =>
      bucket(b.matchScore) - bucket(a.matchScore) ||
      formatRank(kind, a.format) - formatRank(kind, b.format) ||
      b.seeders - a.seeders,
  );
}

export async function checkAvailability(mam: MamClient, book: Book, kind: MediaKind): Promise<AvailabilityResponse> {
  if (!mam.isConfigured()) {
    return {
      status: 'not-configured',
      message: 'Connect MAM in Lectern’s settings to see what’s available.',
      queries: [],
      matches: [],
      others: [],
    };
  }

  const found = new Map<string, MamTorrent>();
  const sent: string[] = [];
  try {
    for (const query of buildQueries(book)) {
      sent.push(query);
      for (const t of await mam.search(query, kind)) {
        if (!found.has(t.id)) found.set(t.id, { ...t, matchScore: scoreTorrent(book, t) });
      }
      if ([...found.values()].some((t) => t.matchScore >= STRONG_MATCH)) break;
    }
  } catch (err) {
    if (err instanceof MamError) {
      return {
        status: err.kind === 'not-configured' ? 'not-configured' : err.kind,
        message: err.message,
        queries: sent,
        matches: [],
        others: [],
      };
    }
    throw err;
  }

  const ranked = rankTorrents(kind, [...found.values()]);
  return {
    status: 'ok',
    queries: sent,
    matches: ranked.filter((t) => t.matchScore >= GOOD_MATCH),
    others: ranked.filter((t) => t.matchScore < GOOD_MATCH && t.matchScore >= 0.3).slice(0, SHOWN_OTHERS),
  };
}
