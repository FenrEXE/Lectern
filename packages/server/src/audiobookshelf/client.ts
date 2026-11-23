// The little Lectern needs from Audiobookshelf: list its libraries (so the
// admin can pick one per profile) and "scan this library", so a newly filed
// book shows up straight away.
import { USER_AGENT, type FetchFn } from '../http.js';

type AbsSettings = { url?: string; apiKey?: string };

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: string;
  /** Folder paths as Audiobookshelf sees them (inside its container). */
  folders: string[];
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

  private async call(method: string, path: string, notFound = 'Audiobookshelf answered 404.'): Promise<Response> {
    if (!this.isConfigured()) throw new Error('Audiobookshelf isn’t set up (address and API key).');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.settings.url}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Can’t reach Audiobookshelf: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Audiobookshelf didn’t accept the API key.');
    if (res.status === 404) throw new Error(notFound);
    if (!res.ok) throw new Error(`Audiobookshelf answered ${res.status}.`);
    return res;
  }
}
