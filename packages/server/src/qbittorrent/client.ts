// Talking to qBittorrent's Web API (v2), in a way that works across versions.
//
// The classic trap: older versions answer a good login with "Ok.", newer ones
// with an empty body, so apps that look for "Ok." think it failed. Lectern
// never trusts the wording. A login worked if qBittorrent gave us a session
// cookie (SID) or if a test call succeeds right after.
import { USER_AGENT, type FetchFn } from '../http.js';

export type QbErrorKind = 'not-configured' | 'unreachable' | 'bad-login' | 'banned' | 'error';

export class QbError extends Error {
  constructor(
    readonly kind: QbErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'QbError';
  }
}

export interface QbSettings {
  url?: string;
  username?: string;
  password?: string;
}

/** The parts of a torrent's status Lectern uses. */
export interface QbTorrent {
  hash: string;
  name: string;
  /** 0–1 */
  progress: number;
  state: string;
  save_path: string;
  content_path?: string;
  /** Bytes per second. */
  dlspeed: number;
  /** Seconds left; qBittorrent uses 8640000 for "unknown". */
  eta: number;
}

export interface QbFile {
  /** Path inside the torrent, e.g. "Book/01.mp3". */
  name: string;
  size: number;
  progress: number;
}

// qBittorrent states meaning "something is wrong with this torrent".
const ERROR_STATES = new Set(['error', 'missingFiles']);

export function isFinished(t: QbTorrent): boolean {
  return t.progress >= 1 && !ERROR_STATES.has(t.state) && !t.state.startsWith('checking');
}

export function hasError(t: QbTorrent): boolean {
  return ERROR_STATES.has(t.state);
}

export class QbClient {
  private sid?: string;

  constructor(
    private readonly settings: QbSettings,
    private readonly fetchFn: FetchFn,
  ) {}

  isConfigured(): boolean {
    return !!this.settings.url;
  }

  /** The qBittorrent version, e.g. "v5.0.4". Also proves we're logged in. */
  async version(): Promise<string> {
    return (await this.call('/api/v2/app/version')).text();
  }

  /** Make sure a category exists, so Lectern's downloads are easy to find in qBittorrent. */
  async ensureCategory(name: string, savePath?: string): Promise<void> {
    const form = new URLSearchParams({ category: name });
    if (savePath) form.set('savePath', savePath);
    // 409 means "already exists", which is fine.
    await this.call('/api/v2/torrents/createCategory', { method: 'POST', body: form }, [409]);
  }

  /** Add a .torrent file. Success is checked by looking the torrent up afterwards, not by the reply text. */
  async addTorrent(file: Buffer, opts: { category?: string; savePath?: string; tags?: string }): Promise<void> {
    const form = new FormData();
    form.append('torrents', new Blob([new Uint8Array(file)], { type: 'application/x-bittorrent' }), 'lectern.torrent');
    if (opts.category) form.append('category', opts.category);
    if (opts.savePath) form.append('savepath', opts.savePath);
    if (opts.tags) form.append('tags', opts.tags);
    // Newer versions answer 409 when the torrent is already there, which is fine.
    await this.call('/api/v2/torrents/add', { method: 'POST', body: form }, [409]);
  }

  async torrent(hash: string): Promise<QbTorrent | undefined> {
    const res = await this.call(`/api/v2/torrents/info?${new URLSearchParams({ hashes: hash })}`);
    const list = (await res.json()) as QbTorrent[];
    return list.find((t) => t.hash.toLowerCase() === hash.toLowerCase());
  }

  async files(hash: string): Promise<QbFile[]> {
    const res = await this.call(`/api/v2/torrents/files?${new URLSearchParams({ hash })}`);
    return (await res.json()) as QbFile[];
  }

  // ── Plumbing ──

  /** Call the API, logging in first if needed, and once more if the session has expired. */
  private async call(path: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<Response> {
    if (!this.settings.url) throw new QbError('not-configured', 'qBittorrent isn’t set up yet. Set QB_URL.');
    if (!this.sid) await this.login();
    let res = await this.raw(path, init);
    if (res.status === 403) {
      // Session expired (or qBittorrent restarted). Log in again, once.
      this.sid = undefined;
      await this.login();
      res = await this.raw(path, init);
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new QbError('error', `qBittorrent answered ${res.status} to ${path.split('?')[0]}.`);
    }
    return res;
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.settings.url!;
    try {
      return await this.fetchFn(`${url}${path}`, {
        ...init,
        headers: {
          'User-Agent': USER_AGENT,
          // qBittorrent checks these to block cross-site requests.
          Referer: url,
          Origin: url,
          ...(this.sid ? { Cookie: `SID=${this.sid}` } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new QbError('unreachable', `Can’t reach qBittorrent at ${url}: ${(err as Error).message}`);
    }
  }

  private async login(): Promise<void> {
    const form = new URLSearchParams({
      username: this.settings.username ?? '',
      password: this.settings.password ?? '',
    });
    const res = await this.raw('/api/v2/auth/login', { method: 'POST', body: form });
    if (res.status === 403) {
      throw new QbError('banned', 'qBittorrent is blocking logins after too many failed attempts. Wait, then check QB_USER and QB_PASS.');
    }
    const sid = readSid(res.headers);
    if (sid) {
      this.sid = sid;
      return;
    }
    // No cookie: either the password is wrong, or qBittorrent doesn't need one
    // (e.g. "bypass authentication for localhost"). A test call tells them apart.
    const check = await this.raw('/api/v2/app/version');
    if (check.ok) return;
    throw new QbError('bad-login', 'qBittorrent didn’t accept the username or password (QB_USER / QB_PASS).');
  }
}

function readSid(headers: Headers): string | undefined {
  const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? ''];
  for (const line of all) {
    const m = /(?:^|[;,]\s*)SID=([^;,\s]+)/.exec(line);
    if (m?.[1]) return m[1];
  }
  return undefined;
}
