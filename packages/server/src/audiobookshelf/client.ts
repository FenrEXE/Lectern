// What Lectern needs from Audiobookshelf: list its libraries (so the admin can
// pick one per profile), "scan this library" (so a newly filed book shows up
// straight away), and, for Tidy up, read books and fix their details.
import type { SeriesPosition, TidyBook } from '@lectern/shared';
import { USER_AGENT, type FetchFn } from '../http.js';

type AbsSettings = { url?: string; apiKey?: string };

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: string;
  /** Folder paths as Audiobookshelf sees them (inside its container). */
  folders: string[];
}

/** A book in an Audiobookshelf library, as Tidy up sees it. */
export interface AbsItem {
  id: string;
  /** Folder inside the library, e.g. "Brandon Sanderson/Mistborn/Book 1". */
  relPath?: string;
  isMissing: boolean;
  book: TidyBook;
}

/** The fields Tidy up writes. Authors, narrators and series replace what's there. */
export interface AbsMetadataUpdate {
  title?: string;
  subtitle?: string | null;
  authors?: Array<{ name: string }>;
  narrators?: string[];
  series?: Array<{ name: string; sequence: string | null }>;
  asin?: string | null;
  publishedYear?: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const splitNames = (v: unknown): string[] => (str(v) ?? '').split(/\s*,\s*/).filter(Boolean);

/**
 * Read a library item's book details. Audiobookshelf sends either full
 * objects (authors: [{name}], series: [{name, sequence}]) or, in short lists,
 * flat text ("authorName": "A, B", "seriesName": "Mistborn #1"). Both work.
 */
export function parseAbsItem(raw: unknown): AbsItem | undefined {
  if (!isObj(raw) || !str(raw.id)) return undefined;
  const media = isObj(raw.media) ? raw.media : {};
  const m = isObj(media.metadata) ? media.metadata : {};

  const authors = Array.isArray(m.authors)
    ? m.authors.map((a) => (isObj(a) ? str(a.name) : str(a))).filter((a): a is string => !!a)
    : splitNames(m.authorName);
  const narrators = Array.isArray(m.narrators)
    ? m.narrators.map(str).filter((n): n is string => !!n)
    : splitNames(m.narratorName);
  let series: SeriesPosition[];
  if (Array.isArray(m.series)) {
    series = m.series.filter(isObj).flatMap((s) => {
      const name = str(s.name);
      if (!name) return [];
      const number = str(s.sequence);
      return [number ? { name, number } : { name }];
    });
  } else {
    series = splitNames(m.seriesName).map((part) => {
      const match = /^(.*?)\s*#\s*([\d.\-–]+)$/.exec(part);
      return match ? { name: match[1]!, number: match[2]! } : { name: part };
    });
  }
  const year = Number(str(m.publishedYear));
  return {
    id: str(raw.id)!,
    relPath: str(raw.relPath),
    isMissing: raw.isMissing === true,
    book: {
      title: str(m.title) ?? '',
      subtitle: str(m.subtitle),
      authors,
      narrators,
      series,
      asin: str(m.asin),
      isbn: str(m.isbn),
      publishedYear: Number.isFinite(year) && year > 0 ? year : undefined,
      hasCover: !!str(media.coverPath),
    },
  };
}

export class AbsClient {
  constructor(
    private readonly source: AbsSettings | (() => AbsSettings),
    private readonly fetchFn: FetchFn,
  ) {}

  private get settings(): AbsSettings {
    return typeof this.source === 'function' ? this.source() : this.source;
  }

  isConfigured(): boolean {
    return !!(this.settings.url && this.settings.apiKey);
  }

  /** The libraries this API key can see. */
  async libraries(): Promise<AbsLibrary[]> {
    const res = await this.call('GET', '/api/libraries');
    const body = (await res.json()) as { libraries?: Array<Record<string, unknown>> };
    return (body.libraries ?? []).map((l) => ({
      id: String(l.id),
      name: String(l.name),
      mediaType: String(l.mediaType ?? 'book'),
      folders: Array.isArray(l.folders) ? l.folders.map((f) => String((f as { fullPath?: string }).fullPath ?? '')) : [],
    }));
  }

  /** Ask Audiobookshelf to scan a library for new books. */
  async scanLibrary(libraryId: string): Promise<void> {
    await this.call('POST', `/api/libraries/${encodeURIComponent(libraryId)}/scan`, 'Audiobookshelf doesn’t know that library ID.');
  }

  // ── Tidy up ──

  /** One page of a library's books (page 0 first). */
  async libraryItems(libraryId: string, page: number, limit = 100): Promise<{ items: AbsItem[]; total: number }> {
    const params = new URLSearchParams({ limit: String(limit), page: String(page), minified: '0' });
    const res = await this.call('GET', `/api/libraries/${encodeURIComponent(libraryId)}/items?${params}`, 'Audiobookshelf doesn’t know that library ID.');
    const body = (await res.json()) as { results?: unknown[]; total?: number };
    const items = (body.results ?? []).map(parseAbsItem).filter((i): i is AbsItem => !!i);
    return { items, total: Number(body.total ?? items.length) };
  }

  /** One book, fresh (used right before changing it). */
  async item(itemId: string): Promise<AbsItem> {
    const res = await this.call('GET', `/api/items/${encodeURIComponent(itemId)}?expanded=1`, 'That book is no longer in Audiobookshelf.');
    const item = parseAbsItem(await res.json());
    if (!item) throw new Error('Audiobookshelf sent a book Lectern can’t read.');
    return item;
  }

  /** Change a book's details. Audiobookshelf finds (or creates) authors and series by name. */
  async updateMetadata(itemId: string, metadata: AbsMetadataUpdate): Promise<void> {
    await this.call('PATCH', `/api/items/${encodeURIComponent(itemId)}/media`, 'That book is no longer in Audiobookshelf.', { metadata });
  }

  /** Audiobookshelf downloads the cover from this address itself. */
  async setCoverFromUrl(itemId: string, url: string): Promise<void> {
    await this.call('POST', `/api/items/${encodeURIComponent(itemId)}/cover`, 'That book is no longer in Audiobookshelf.', { url });
  }

  async removeCover(itemId: string): Promise<void> {
    await this.call('DELETE', `/api/items/${encodeURIComponent(itemId)}/cover`, 'That book is no longer in Audiobookshelf.');
  }

  private async call(method: string, path: string, notFound = 'Audiobookshelf answered 404.', body?: unknown): Promise<Response> {
    if (!this.isConfigured()) throw new Error('Audiobookshelf isn’t set up (address and API key).');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.settings.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          'User-Agent': USER_AGENT,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new Error(`Can’t reach Audiobookshelf: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Audiobookshelf didn’t accept the API key (it needs an admin’s key to change books).');
    if (res.status === 404) throw new Error(notFound);
    if (!res.ok) throw new Error(`Audiobookshelf answered ${res.status}.`);
    return res;
  }
}
