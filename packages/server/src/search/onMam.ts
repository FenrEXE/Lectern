// "Check MAM" on author and series pages: one MAM search for the whole page
// (the series name with the author's surname, or the author), then each book
// on the page is matched against what came back. No request per book.
//
// Only when the person taps the button, never when the page opens.
import { languageId, languageMatches, type MediaKind, type OnMamRequest, type OnMamResponse } from '@lectern/shared';
import type { MamClient } from '../mam/client.js';
import { MamError } from '../mam/parse.js';
import { rankTorrents, scoreTorrent } from './availability.js';

// Same bar as opening a single book: below this it's probably another book.
const GOOD_MATCH = 0.7;

export async function checkOnMam(
  mam: MamClient,
  request: OnMamRequest,
  kind: MediaKind,
  options: { language: string },
): Promise<OnMamResponse> {
  if (!mam.isConfigured()) {
    return { status: 'not-configured', message: 'Connect MAM in Lectern’s settings first.', found: {} };
  }
  let torrents;
  try {
    torrents = await mam.search(request.query, kind);
  } catch (err) {
    if (err instanceof MamError) return { status: err.kind, message: err.message, found: {} };
    throw err;
  }
  const usable = torrents.filter((t) => languageMatches(languageId(t.language), options.language));

  const found: OnMamResponse['found'] = {};
  for (const book of request.books) {
    const matches = usable
      .map((t) => ({ ...t, matchScore: scoreTorrent(book, t) }))
      .filter((t) => t.matchScore >= GOOD_MATCH);
    if (matches.length) found[book.id] = rankTorrents(kind, matches);
  }
  return { status: 'ok', found };
}
