// Types and small helpers shared by the server and the web app.
// Keep this package free of Node- or browser-only code.

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
  authors: string[];
  narrators?: string[];
  series?: SeriesPosition[];
  description?: string;
  /** Audible ID, used to pin audiobook matches in Audiobookshelf. */
  asin?: string;
  /** Used to pin ebook matches. */
  isbn?: string;
  publishedYear?: number;
  coverUrl?: string;
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

/**
 * Normalise text for comparing titles and names: lower case, no accents,
 * no punctuation, single spaces. "The Well of Ascension!" → "the well of ascension".
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
