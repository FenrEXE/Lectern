// Lectern's only door to MAM. Everything that talks to MAM goes through here,
// so the politeness rules live in one place:
//
//  - one request at a time, at least MIN_GAP_MS apart;
//  - answers cached for CACHE_TTL, so repeats cost MAM nothing;
//  - MAM's refreshed session cookie is saved after every good answer, so the
//    session keeps renewing itself instead of expiring;
//  - optionally, refuse to send anything unless a VPN interface (e.g. wg0) is
//    up, so MAM never sees your home IP.
import os from 'node:os';
import { normalizeText, type MediaKind } from '@lectern/shared';
import { cacheGet, cacheSet, MINUTE } from '../cache.js';
import type { Config } from '../config.js';
import { getSetting, setSetting, type Db } from '../db.js';
import { USER_AGENT, type FetchFn } from '../http.js';
import { MamError, parseSearchResponse, type ParsedTorrent } from './parse.js';

const SEARCH_URL = 'https://www.myanonamouse.net/tor/js/loadSearchJSONbasic.php';
const MIN_GAP_MS = 2_000;
const CACHE_TTL = 15 * MINUTE;
const TIMEOUT_MS = 20_000;

// MAM's main categories. 13 = AudioBooks, 14 = E-Books.
const MAIN_CATEGORY: Record<MediaKind, string> = { audiobook: '13', ebook: '14' };

// Where the newest session cookie is kept, and which MAM_ID setting it came from.
const STORED_COOKIE = 'mam.cookie';
const STORED_FROM = 'mam.cookie.from';

export interface MamClientOptions {
  db: Db;
  config: Config;
  fetch: FetchFn;
  /** For tests: replaceable clock, sleep and network-interface list. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  interfaceNames?: () => string[];
  log?: { info: (obj: object, msg: string) => void };
}

export class MamClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly interfaceNames: () => string[];

  constructor(private readonly opts: MamClientOptions) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.interfaceNames = opts.interfaceNames ?? (() => Object.keys(os.networkInterfaces()));
  }

  isConfigured(): boolean {
    return this.cookie() !== undefined;
  }

  /**
   * The cookie to use: the newest one MAM gave us, unless MAM_ID has been
   * changed since (a newly pasted cookie always wins).
   */
  private cookie(): string | undefined {
    const fromEnv = this.opts.config.mam.cookie;
    const stored = getSetting(this.opts.db, STORED_COOKIE);
    const storedFrom = getSetting(this.opts.db, STORED_FROM);
    if (stored && storedFrom === (fromEnv ?? '')) return stored;
    return fromEnv;
  }

  private saveCookie(value: string): void {
    setSetting(this.opts.db, STORED_COOKIE, value);
    setSetting(this.opts.db, STORED_FROM, this.opts.config.mam.cookie ?? '');
  }

  /** Search one category. Cached; queued behind any other MAM request. */
  async search(text: string, kind: MediaKind): Promise<ParsedTorrent[]> {
    const key = `mam:search:${kind}:${normalizeText(text)}`;
    const hit = cacheGet<ParsedTorrent[]>(this.opts.db, key, this.now());
    if (hit) return hit;
    const results = await this.enqueue(() => this.request(text, kind));
    cacheSet(this.opts.db, key, results, CACHE_TTL, this.now());
    return results;
  }

  /** Run `task` after every earlier request, keeping MIN_GAP_MS between requests. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastRequestAt + MIN_GAP_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
      return task();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async request(text: string, kind: MediaKind): Promise<ParsedTorrent[]> {
    const cookie = this.cookie();
    if (!cookie) throw new MamError('not-configured', 'MAM isn’t set up yet. Add your mam_id in Lectern’s settings.');

    const iface = this.opts.config.mam.requireInterface;
    if (iface && !this.interfaceNames().includes(iface)) {
      throw new MamError('vpn-down', `The VPN (${iface}) isn’t up, so Lectern won’t contact MAM.`);
    }

    const body = {
      tor: {
        text,
        srchIn: ['title', 'author', 'narrator', 'series'],
        searchType: 'all',
        searchIn: 'torrents',
        sortType: 'default',
        startNumber: '0',
        main_cat: [MAIN_CATEGORY[kind]],
      },
      perpage: 50,
    };

    let res: Response;
    try {
      res = await this.opts.fetch(`${SEARCH_URL}?dlLink=1`, {
        method: 'POST',
        headers: {
          Cookie: `mam_id=${cookie}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new MamError('error', `Couldn’t reach MAM: ${(err as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new MamError('session-expired', 'MAM rejected the session. Paste a fresh mam_id.');
    }
    const textBody = await res.text();
    if (!res.ok) throw new MamError('error', `MAM answered ${res.status}.`);

    let json: unknown;
    try {
      json = JSON.parse(textBody);
    } catch {
      // A login page instead of JSON means the session has ended.
      if (/log ?in/i.test(textBody)) {
        throw new MamError('session-expired', 'MAM asked to log in. Paste a fresh mam_id.');
      }
      throw new MamError('error', 'MAM sent something that isn’t search results.');
    }

    // Throws on session errors, so a cookie is only saved after a good answer.
    const torrents = parseSearchResponse(json);

    const fresh = readMamCookie(res.headers);
    if (fresh && fresh !== cookie) {
      this.saveCookie(fresh);
      this.opts.log?.info({}, 'Saved refreshed MAM session cookie');
    }
    return torrents;
  }
}

/** Find a new mam_id in the response's Set-Cookie headers. */
export function readMamCookie(headers: Headers): string | undefined {
  const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  for (const line of all) {
    const match = /(?:^|[;,]\s*)mam_id=([^;,\s]+)/.exec(line);
    if (match?.[1] && match[1] !== 'deleted') return match[1];
  }
  return undefined;
}
