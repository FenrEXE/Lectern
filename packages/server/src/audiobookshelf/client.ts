// The little Lectern needs from Audiobookshelf for now: "scan this library",
// so a newly filed book shows up straight away.
import { USER_AGENT, type FetchFn } from '../http.js';

export class AbsClient {
  constructor(
    private readonly settings: { url?: string; apiKey?: string },
    private readonly fetchFn: FetchFn,
  ) {}

  isConfigured(): boolean {
    return !!(this.settings.url && this.settings.apiKey);
  }

  /** Ask Audiobookshelf to scan a library for new books. */
  async scanLibrary(libraryId: string): Promise<void> {
    if (!this.isConfigured()) throw new Error('Audiobookshelf isn’t set up (ABS_URL and ABS_API_KEY).');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.settings.url}/api/libraries/${encodeURIComponent(libraryId)}/scan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Can’t reach Audiobookshelf: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('Audiobookshelf didn’t accept the API key.');
    if (res.status === 404) throw new Error('Audiobookshelf doesn’t know that library ID.');
    if (!res.ok) throw new Error(`Audiobookshelf answered ${res.status} to the scan.`);
  }
}
