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
import { readConfig, type ConfigSource } from '../config.js';
import { getSetting, setSetting, type Db } from '../db.js';
import { USER_AGENT, type FetchFn } from '../http.js';
import { MamError, parseAccountStats, parseSearchResponse, type ParsedTorrent } from './parse.js';

const SEARCH_URL = 'https://www.myanonamouse.net/tor/js/loadSearchJSONbasic.php';
const DOWNLOAD_URL = 'https://www.myanonamouse.net/tor/download.php';
// Your own account summary (ratio, unsatisfied torrents). Asked at most hourly.
const ACCOUNT_URL = 'https://www.myanonamouse.net/jsonLoad.php?snatch_summary';
const MIN_GAP_MS = 2_000;
// Search answers are kept for a few hours and shared by every profile, so the
// same search costs MAM nothing the second time.
const CACHE_TTL = 3 * 60 * MINUTE;
/**
 * At most this many searches reach MAM per day (cached answers don't count).
 * A safety net against loops or someone hammering the button; normal use is
 * far below it.
 */
export const DAILY_SEARCH_LIMIT = 150;
const TIMEOUT_MS = 20_000;

// MAM's main categories. 13 = AudioBooks, 14 = E-Books.
const MAIN_CATEGORY: Record<MediaKind, string> = { audiobook: '13', ebook: '14' };

// Where the newest session cookie is kept, and which MAM_ID setting it came from.
const STORED_COOKIE = 'mam.cookie';
const STORED_FROM = 'mam.cookie.from';

export interface MamClientOptions {
  db: Db;
  config: ConfigSource;
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

  private get config() {
    return readConfig(this.opts.config);
  }

  isConfigured(): boolean {
    return this.cookie() !== undefined;
  }

  /**
   * The cookie to use: the newest one MAM gave us, unless MAM_ID has been
   * changed since (a newly pasted cookie always wins).
   */
  private cookie(): string | undefined {
    const fromEnv = this.config.mam.cookie;
    const stored = getSetting(this.opts.db, STORED_COOKIE);
    const storedFrom = getSetting(this.opts.db, STORED_FROM);
    if (stored && storedFrom === (fromEnv ?? '')) return stored;
    return fromEnv;
  }

  private saveCookie(value: string): void {
    setSetting(this.opts.db, STORED_COOKIE, value);
    setSetting(this.opts.db, STORED_FROM, this.config.mam.cookie ?? '');
  }

  /** A recent answer for this search, without contacting MAM (undefined if none). */
  cachedSearch(text: string, kind: MediaKind): ParsedTorrent[] | undefined {
    return cacheGet<ParsedTorrent[]>(this.opts.db, `mam:search:${kind}:${normalizeText(text)}`, this.now());
  }

  /** Search one category. Cached; queued behind any other MAM request. */
  async search(text: string, kind: MediaKind): Promise<ParsedTorrent[]> {
    const key = `mam:search:${kind}:${normalizeText(text)}`;
    const hit = cacheGet<ParsedTorrent[]>(this.opts.db, key, this.now());
    if (hit) return hit;
    this.countSearch();
    const results = await this.enqueue(() => this.request(text, kind));
    cacheSet(this.opts.db, key, results, CACHE_TTL, this.now());
    return results;
  }

  /** Searches sent to MAM today (UTC). */
  searchesToday(): number {
    return Number(getSetting(this.opts.db, `mam.searches.${this.today()}`) ?? 0);
  }

  private today(): string {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  /** Count one search against today's limit, or refuse if it's used up. */
  private countSearch(): void {
    const used = this.searchesToday();
    if (used >= DAILY_SEARCH_LIMIT) {
      throw new MamError(
        'daily-limit',
        `Lectern has searched MAM ${DAILY_SEARCH_LIMIT} times today, its daily limit. Searches you've already done still work; new ones can wait until tomorrow (UTC).`,
      );
    }
    setSetting(this.opts.db, `mam.searches.${this.today()}`, String(used + 1));
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

  /** The cookie to send, after checking MAM is set up and the VPN is up. */
  private ready(): string {
    const cookie = this.cookie();
    if (!cookie) throw new MamError('not-configured', 'MAM isn’t set up yet. Add your mam_id in Lectern’s settings.');
    const iface = this.config.mam.requireInterface;
    if (iface && !this.interfaceNames().includes(iface)) {
      throw new MamError('vpn-down', `The VPN (${iface}) isn’t up, so Lectern won’t contact MAM.`);
    }
    return cookie;
  }

  /** Save MAM's refreshed cookie. Only call this after a good answer. */
  private keepFreshCookie(res: Response, sent: string): void {
    const fresh = readMamCookie(res.headers);
    if (fresh && fresh !== sent) {
      this.saveCookie(fresh);
      this.opts.log?.info({}, 'Saved refreshed MAM session cookie');
    }
  }

  private async send(url: string, cookie: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.opts.fetch(url, {
        ...init,
        headers: { Cookie: `mam_id=${cookie}`, 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new MamError('error', `Couldn’t reach MAM: ${(err as Error).message}`);
    }
  }

  private async request(text: string, kind: MediaKind): Promise<ParsedTorrent[]> {
    const cookie = this.ready();
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
      // One search should find everything relevant, so ask for a full page.
      perpage: 100,
      // Ask for ISBNs (often blank, but a perfect match when present).
      isbn: 'true',
    };

    // No dlLink: those are personal download keys, and Lectern downloads with
    // the session cookie instead, so it never needs or stores them.
    const res = await this.send(SEARCH_URL, cookie, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

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
    this.keepFreshCookie(res, cookie);
    return torrents;
  }

  /**
   * Fetch one .torrent file. Uses the session cookie, never a freeleech wedge:
   * adding "&fl" would spend one, with no refunds, so Lectern never does.
   * Not cached: each call is a real download the person asked for.
   */
  async downloadTorrent(torrentId: string): Promise<Buffer> {
    if (!/^\d+$/.test(torrentId)) throw new MamError('error', 'That isn’t a MAM torrent ID.');
    return this.enqueue(async () => {
      const cookie = this.ready();
      const res = await this.send(`${DOWNLOAD_URL}?tid=${torrentId}`, cookie);
      if (res.status === 401 || res.status === 403) {
        throw new MamError('session-expired', 'MAM rejected the session. Paste a fresh mam_id.');
      }
      if (!res.ok) throw new MamError('error', `MAM answered ${res.status} to the download.`);
      const data = Buffer.from(await res.arrayBuffer());
      // A real .torrent starts with "d". Anything else is an error or login page.
      if (data[0] !== 0x64) {
        const text = data.subarray(0, 2000).toString('utf8');
        if (/log ?in/i.test(text)) {
          throw new MamError('session-expired', 'MAM asked to log in. Paste a fresh mam_id.');
        }
        throw new MamError('error', 'MAM didn’t send a torrent file.');
      }
      this.keepFreshCookie(res, cookie);
      return data;
    });
  }

  /** Your account's ratio and unsatisfied count. Queued like every MAM request. */
  async accountStats(): Promise<ReturnType<typeof parseAccountStats>> {
    return this.enqueue(async () => {
      const cookie = this.ready();
      const res = await this.send(ACCOUNT_URL, cookie, { headers: { Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        throw new MamError('session-expired', 'MAM rejected the session. Paste a fresh mam_id.');
      }
      const text = await res.text();
      if (!res.ok) throw new MamError('error', `MAM answered ${res.status}.`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        if (/log ?in/i.test(text)) throw new MamError('session-expired', 'MAM asked to log in. Paste a fresh mam_id.');
        throw new MamError('error', 'MAM sent something that isn’t account details.');
      }
      const stats = parseAccountStats(json);
      this.keepFreshCookie(res, cookie);
      return stats;
    });
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
