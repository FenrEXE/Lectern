// Types shared by the server and the web app.

/** The two kinds of book Lectern handles. */
export type MediaKind = 'audiobook' | 'ebook';

/** A book's place in a series, e.g. Mistborn #2. */
export interface SeriesPosition {
  name: string;
  /** Kept as text because series use numbers like "2.5" or "0". */
  number?: string;
}

/** A book as Lectern understands it, after metadata matching. */
export interface Book {
  title: string;
  subtitle?: string;
  authors: string[];
  narrators?: string[];
  series?: SeriesPosition[];
  description?: string;
  /** Audible ID, used to pin audiobook matches in Audiobookshelf. */
  asin?: string;
  /** Used to pin ebook matches. */
  isbn?: string;
  publishedYear?: number;
  durationMinutes?: number;
  coverUrl?: string;
}

/** Where a suggestion's details came from. */
export type MetadataSource = 'audible' | 'google' | 'openlibrary';

/** A source that couldn't help with this search, and why. */
export interface SourceProblem {
  source: MetadataSource;
  /** 'limit': over its request limit for now. 'error': anything else. */
  reason: 'limit' | 'error';
}

/** One entry in the "Did you mean" list. */
export interface BookSuggestion extends Book {
  /** Stable id, e.g. "audible:B002UZMLXM". */
  id: string;
  source: MetadataSource;
  /** How well it matches what was typed, 0–1. */
  score: number;
}

/** What GET /api/suggest returns. */
export interface SuggestResponse {
  query: string;
  kind: MediaKind;
  /** The query with typos corrected, when Lectern is confident; else absent. */
  didYouMean?: string;
  suggestions: BookSuggestion[];
  /** Sources that couldn't help this time (the others still answered). */
  problems: SourceProblem[];
}

/** A torrent on MAM, simplified. */
export interface MamTorrent {
  id: string;
  title: string;
  authors: string[];
  narrators: string[];
  series: SeriesPosition[];
  /** Lower-case file types in the torrent, e.g. ["m4b"] or ["m4a", "mp3"]. */
  formats: string[];
  /** Ready to show, e.g. "622.9 MiB". */
  size?: string;
  seeders: number;
  leechers: number;
  category?: string;
  /** 3-letter language code, e.g. "ENG". */
  language?: string;
  added?: string;
  isbn?: string;
  /** Free to download (sitewide freeleech, or bought as a personal freeleech). */
  freeleech: boolean;
  vip: boolean;
  /** You've downloaded this torrent before. */
  snatched: boolean;
  /** A pack of several books (e.g. series number "01-16"), not one book. */
  collection: boolean;
  /** How well this torrent matches the chosen book, 0–1. */
  matchScore: number;
}

export type AvailabilityStatus =
  | 'ok'
  | 'not-configured'
  | 'session-expired'
  | 'vpn-down'
  | 'error';

/** What POST /api/availability returns. */
export interface AvailabilityResponse {
  status: AvailabilityStatus;
  /** Human-readable explanation when status isn't "ok". */
  message?: string;
  /** The MAM searches that were actually sent (or answered from cache). */
  queries: string[];
  /** Good matches for the chosen book, best first. */
  matches: MamTorrent[];
  /** Other results from the same searches that matched less well. */
  others: MamTorrent[];
}

/** Whether Lectern has the settings it needs for each outside service. */
export type ServiceState = 'configured' | 'not-configured';

/** What GET /api/health returns. */
export interface HealthResponse {
  status: 'ok';
  name: 'Lectern';
  version: string;
  services: {
    mam: ServiceState;
    qbittorrent: ServiceState;
    audiobookshelf: ServiceState;
  };
}
