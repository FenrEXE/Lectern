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
  /** The book's language, as Lectern's id ("english"), when the source says. */
  language?: string;
  /**
   * Audible's ID for each author, by name. Two authors with nearly the same
   * name (R. Knight, R.J. Knight) have different IDs, so author pages use it.
   */
  authorIds?: Record<string, string>;
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

/** One series on an author page, books in reading order. */
export interface SeriesGroup {
  name: string;
  books: BookSuggestion[];
}

/** What GET /api/author returns. */
export interface AuthorResponse {
  author: string;
  kind: MediaKind;
  series: SeriesGroup[];
  /** Books not in a series, newest first. */
  standalone: BookSuggestion[];
  problems: SourceProblem[];
}

/** What GET /api/series returns. */
export interface SeriesResponse {
  series: string;
  author?: string;
  kind: MediaKind;
  /** In reading order. Each book's first series is this one. */
  books: BookSuggestion[];
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
  | 'daily-limit'
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

/** Where an "Add to Library" request is up to. */
export type RequestStatus = 'sending' | 'downloading' | 'importing' | 'done' | 'failed';

/** One "Add to Library": a chosen book and the MAM torrent picked for it. */
export interface LibraryRequest {
  id: number;
  kind: MediaKind;
  status: RequestStatus;
  book: Book;
  torrentId: string;
  torrentTitle: string;
  /** Download progress, 0–1. */
  progress: number;
  /** Seconds left, when qBittorrent knows. */
  etaSeconds?: number;
  /** What went wrong, or a note like "Already in your library". */
  message?: string;
  /** Where the book was filed, relative to the library folder. */
  libraryPath?: string;
  /** Who asked for it. */
  userId?: number;
  userName?: string;
  createdAt: string;
  updatedAt: string;
}

/** A profile's own library for one kind of book. */
export interface ProfileLibrary {
  /** The folder books are filed into, as Lectern sees it. */
  dir?: string;
  /** The Audiobookshelf library to scan after filing. */
  absLibraryId?: string;
}

/** A person who uses Lectern. */
export interface Profile {
  id: number;
  name: string;
  role: 'admin' | 'member';
  /** Avatar colour, e.g. "#3E6B52". */
  color: string;
  defaultKind: MediaKind;
  /** Only show books in this language (Lectern's id, e.g. "english"), or "any". */
  language: string;
  libraries: Record<MediaKind, ProfileLibrary>;
}

/** What the sign-in page shows for each profile. */
export interface ProfileCard {
  id: number;
  name: string;
  color: string;
}

/** What GET /api/auth/me returns. */
export interface MeResponse {
  /** True when no profiles exist yet, so the first visitor creates the admin. */
  setupNeeded: boolean;
  /** The signed-in profile, if any. */
  me: Profile | null;
}

/** What GET /api/auth/profiles returns. */
export interface ProfilesResponse {
  setupNeeded: boolean;
  /** Empty when the admin has chosen to hide names on the sign-in page. */
  profiles: ProfileCard[];
}

/** Whether Lectern has the settings it needs for each outside service. */
export type ServiceState = 'configured' | 'not-configured';

/** What GET /api/health returns (public: used by Docker's health check). */
export interface HealthResponse {
  status: 'ok';
  name: 'Lectern';
  version: string;
}

/** What GET /api/status returns (signed in). */
export interface StatusResponse {
  version: string;
  services: {
    mam: ServiceState;
    qbittorrent: ServiceState;
    audiobookshelf: ServiceState;
  };
  /** Whether "Add to Library" is set up for each kind of book, for this profile. */
  canAdd: Record<MediaKind, boolean>;
}

/** The MAM account's standing, as last checked (GET /api/mam/stats). */
export interface MamStats {
  /** Uploaded ÷ downloaded. null when nothing has been downloaded yet. */
  ratio: number | null;
  uploadedBytes: number;
  downloadedBytes: number;
  /**
   * Unsatisfied torrents: downloaded but not yet seeded long enough (72 hours).
   * MAM won't allow more downloads once `count` reaches `limit`.
   */
  unsat: { count: number; limit: number } | null;
  /** When MAM was last asked (ms since 1970). */
  checkedAt: number;
}

export interface MamStatsResponse {
  stats: MamStats | null;
  /** Why the last check failed, if it did. The stats shown are then older. */
  problem?: string;
  /** The earliest time "Refresh" may ask MAM again (ms since 1970). */
  refreshAllowedAt: number;
}

/**
 * One book found on MAM: every torrent of it (different formats or uploads)
 * grouped together, best first. What MAM says about the book (title, authors,
 * series) comes from the best torrent.
 */
export interface FoundBook extends Book {
  /** Stable within one search, e.g. "mam:1214223" (the best torrent's id). */
  id: string;
  /** A pack of several books rather than one. */
  pack: boolean;
  torrents: MamTorrent[];
}

/** What GET /api/search returns. One MAM request (or none, when cached). */
export interface SearchResponse {
  query: string;
  kind: MediaKind;
  status: AvailabilityStatus;
  /** Human-readable explanation when status isn't "ok". */
  message?: string;
  /** Books whose title, author or series matches what was typed. */
  books: FoundBook[];
  /** Matched only through the narrator or other fields; shown on request. */
  others: FoundBook[];
  /** How many torrents were hidden for being in another language. */
  hiddenLanguages: number;
  /** When MAM found nothing: a likely spelling, from Audible or Google. Not searched until tapped. */
  didYouMean?: string;
  /**
   * Only set when the page asked for cached results (opening a link or going
   * back): nothing recent was saved, so MAM wasn't asked. Press Search to ask.
   */
  notCached?: boolean;
}

/** Extra details for a found book, from Audible, Google Books or Open Library (never MAM). */
export type BookDetails = Pick<
  Book,
  'subtitle' | 'description' | 'asin' | 'isbn' | 'publishedYear' | 'durationMinutes' | 'coverUrl' | 'narrators' | 'series' | 'authorIds'
>;

/** POST /api/books/details: the books on screen, by id. */
export interface DetailsRequest {
  kind: MediaKind;
  books: Array<{ id: string; title: string; author?: string }>;
}
export type DetailsResponse = Record<string, BookDetails>;

/** POST /api/onmam: which books on an author or series page MAM has, from one MAM search. */
export interface OnMamRequest {
  kind: MediaKind;
  /** What to search MAM for: the series name (plus the author's surname), or the author. */
  query: string;
  books: Array<Pick<Book, 'title' | 'subtitle' | 'authors' | 'series' | 'isbn'> & { id: string }>;
}

export interface OnMamResponse {
  status: AvailabilityStatus;
  message?: string;
  /** The book ids MAM has, each with its torrents (best first). Missing ids: not found. */
  found: Record<string, MamTorrent[]>;
}
