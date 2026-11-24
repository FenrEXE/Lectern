// "Add to Library", from tap to playable book:
//
//   sending      fetch the .torrent from MAM and hand it to qBittorrent
//   downloading  qBittorrent is downloading; a watcher checks every few seconds
//   importing    file the finished book into the library, then ask Audiobookshelf to scan
//   done         ready to listen (or read)
//   failed       something went wrong; the message says what, and it can be retried
//
// Everything is saved in the database, so a restart picks up where it left off.
import path from 'node:path';
import type { Book, LibraryRequest, MediaKind, Profile, ProfileLibrary, RequestStatus } from '@lectern/shared';
import type { AbsClient } from '../audiobookshelf/client.js';
import type { UserStore } from '../auth/users.js';
import { readConfig, type ConfigSource } from '../config.js';
import type { Db } from '../db.js';
import type { FetchFn } from '../http.js';
import { chooseFiles, importBook } from '../library/importer.js';
import type { MamClient } from '../mam/client.js';
import { MamError } from '../mam/parse.js';
import { hasError, isFinished, QbError, type QbClient } from '../qbittorrent/client.js';
import { torrentInfoHash, TorrentFileError } from '../torrent/torrentFile.js';

const WATCH_EVERY_MS = 10_000;

interface Row {
  id: number;
  kind: MediaKind;
  status: RequestStatus;
  book_json: string;
  torrent_id: string;
  torrent_title: string;
  info_hash: string | null;
  progress: number;
  eta_seconds: number | null;
  message: string | null;
  library_path: string | null;
  user_id: number | null;
  user_name?: string | null;
  created_at: string;
  updated_at: string;
}

const toRequest = (r: Row): LibraryRequest => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  book: JSON.parse(r.book_json) as Book,
  torrentId: r.torrent_id,
  torrentTitle: r.torrent_title,
  progress: r.progress,
  etaSeconds: r.eta_seconds ?? undefined,
  message: r.message ?? undefined,
  libraryPath: r.library_path ?? undefined,
  userId: r.user_id ?? undefined,
  userName: r.user_name ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** A problem the person should see, as opposed to a bug. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface RequestServiceOptions {
  db: Db;
  config: ConfigSource;
  /** To find each profile's own library. */
  users?: UserStore;
  fetch: FetchFn;
  mam: MamClient;
  qb: QbClient;
  abs: AbsClient;
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  /** For tests: replaceable sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export class RequestService {
  private timer?: NodeJS.Timeout;
  private watching = false;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: RequestServiceOptions) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get config() {
    return readConfig(this.o.config);
  }

  /**
   * Where a profile's books of this kind go. Each profile has its own folder;
   * requests from before profiles existed use the folders set in the environment.
   */
  libraryFor(userId: number | null | undefined, kind: MediaKind): ProfileLibrary {
    if (userId != null && this.o.users) {
      return this.o.users.get(userId)?.libraries[kind] ?? {};
    }
    return { dir: this.config.libraries[kind], absLibraryId: this.config.audiobookshelf.libraryIds[kind] };
  }

  /**
   * The qBittorrent category for a request, so each person's downloads are easy
   * to tell apart in qBittorrent: the profile's name for audiobooks ("Fenr"),
   * and the name plus "-Ebook" for ebooks ("Fenr-Ebook"). Requests without a
   * profile use QB_CATEGORY.
   */
  categoryFor(userId: number | null | undefined, kind: MediaKind): string {
    const name = userId != null ? this.o.users?.get(userId)?.name : undefined;
    // "/" makes a subcategory in qBittorrent and "\\" isn't allowed, so swap them out.
    const base = name?.replace(/[\\/]+/g, '-').trim();
    if (!base) return this.config.qbittorrent.category;
    return kind === 'ebook' ? `${base}-Ebook` : base;
  }

  /** Whether "Add to Library" is set up for this kind of book (for this profile). */
  canAdd(kind: MediaKind, user?: Profile | null): boolean {
    return this.o.mam.isConfigured() && this.o.qb.isConfigured() && !!this.libraryFor(user?.id, kind).dir;
  }

  /** The newest requests: one profile's, or everyone's (for an admin). */
  list(userId?: number, limit = 50): LibraryRequest[] {
    const select = `SELECT requests.*, users.name AS user_name FROM requests LEFT JOIN users ON users.id = requests.user_id`;
    const rows = (
      userId === undefined
        ? this.o.db.prepare(`${select} ORDER BY requests.id DESC LIMIT ?`).all(limit)
        : this.o.db.prepare(`${select} WHERE requests.user_id = ? ORDER BY requests.id DESC LIMIT ?`).all(userId, limit)
    ) as Row[];
    return rows.map(toRequest);
  }

  get(id: number): LibraryRequest | undefined {
    const row = this.o.db
      .prepare('SELECT requests.*, users.name AS user_name FROM requests LEFT JOIN users ON users.id = requests.user_id WHERE requests.id = ?')
      .get(id) as Row | undefined;
    return row && toRequest(row);
  }

  /** Start an "Add to Library". Returns straight away; the work continues in the background. */
  async create(input: {
    kind: MediaKind;
    book: Book;
    torrentId: string;
    torrentTitle: string;
    userId?: number;
  }): Promise<LibraryRequest> {
    if (!this.libraryFor(input.userId, input.kind).dir) {
      throw new RequestError(
        `Your profile doesn’t have ${input.kind === 'ebook' ? 'an ebook' : 'an audiobook'} library folder yet. An admin can set one in Settings.`,
      );
    }
    if (!this.o.qb.isConfigured()) throw new RequestError('qBittorrent isn’t set up yet.');
    if (!this.o.mam.isConfigured()) throw new RequestError('MAM isn’t set up yet.');

    // The same torrent already requested by this profile (and not failed) → show that one.
    const existing = this.o.db
      .prepare(
        "SELECT * FROM requests WHERE torrent_id = ? AND user_id IS ? AND status != 'failed' ORDER BY id DESC LIMIT 1",
      )
      .get(input.torrentId, input.userId ?? null) as Row | undefined;
    if (existing) return this.get(existing.id)!;

    const now = new Date().toISOString();
    const { lastInsertRowid } = this.o.db
      .prepare(
        `INSERT INTO requests (kind, status, book_json, torrent_id, torrent_title, user_id, created_at, updated_at)
         VALUES (?, 'sending', ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.kind, JSON.stringify(input.book), input.torrentId, input.torrentTitle, input.userId ?? null, now, now);
    const id = Number(lastInsertRowid);
    void this.send(id);
    return this.get(id)!;
  }

  /** Try a failed request again from wherever it got to. */
  retry(id: number): LibraryRequest {
    const req = this.get(id);
    if (!req) throw new RequestError('No such request.', 404);
    if (req.status !== 'failed') return req;
    const hash = (this.o.db.prepare('SELECT info_hash FROM requests WHERE id = ?').get(id) as { info_hash: string | null })
      .info_hash;
    if (hash) {
      this.update(id, { status: 'downloading', message: null });
      void this.watch();
    } else {
      this.update(id, { status: 'sending', message: null });
      void this.send(id);
    }
    return this.get(id)!;
  }

  /** Begin watching downloads. Called once at startup. */
  start(): void {
    // Anything cut off by a restart: sending can't safely resume, so it's marked
    // for retry; importing simply starts again.
    this.o.db
      .prepare("UPDATE requests SET status = 'failed', message = 'Interrupted by a restart. Tap retry.' WHERE status = 'sending'")
      .run();
    this.o.db.prepare("UPDATE requests SET status = 'downloading' WHERE status = 'importing'").run();
    this.timer = setInterval(() => void this.watch(), WATCH_EVERY_MS);
    this.timer.unref();
    void this.watch();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Steps ──

  /** Step 1: fetch the .torrent from MAM and hand it to qBittorrent. */
  async send(id: number): Promise<void> {
    const req = this.get(id);
    if (!req) return;
    try {
      const file = await this.o.mam.downloadTorrent(req.torrentId);
      const hash = torrentInfoHash(file);
      const { savePath } = this.config.qbittorrent;
      const category = this.categoryFor(req.userId, req.kind);
      await this.o.qb.ensureCategory(category, savePath);
      await this.o.qb.addTorrent(file, { category, savePath, tags: 'lectern' });

      // Don't trust qBittorrent's reply text; check the torrent is really there.
      let found = await this.o.qb.torrent(hash);
      for (let i = 0; !found && i < 4; i++) {
        await this.sleep(1_000);
        found = await this.o.qb.torrent(hash);
      }
      if (!found) throw new RequestError('qBittorrent didn’t take the torrent. Check its log.');

      this.o.db.prepare('UPDATE requests SET info_hash = ? WHERE id = ?').run(hash, id);
      this.update(id, { status: 'downloading', progress: found.progress, message: null });
      this.o.log?.info({ id, hash }, 'Sent to qBittorrent');
      void this.watch();
    } catch (err) {
      this.fail(id, err);
    }
  }

  /** Step 2: check every download in progress; import the finished ones. */
  async watch(): Promise<void> {
    if (this.watching) return; // one check at a time
    this.watching = true;
    try {
      const rows = this.o.db.prepare("SELECT * FROM requests WHERE status = 'downloading'").all() as Row[];
      for (const row of rows) {
        try {
          const t = await this.o.qb.torrent(row.info_hash ?? '');
          if (!t) {
            this.update(row.id, { status: 'failed', message: 'The torrent isn’t in qBittorrent any more.' });
            continue;
          }
          if (hasError(t)) {
            this.update(row.id, { status: 'failed', message: `qBittorrent reports a problem (${t.state}).` });
            continue;
          }
          const eta = t.eta > 0 && t.eta < 8_640_000 ? t.eta : null;
          this.update(row.id, { progress: Math.min(1, t.progress), eta_seconds: eta });
          if (isFinished(t)) await this.importFinished(row.id, t.save_path);
        } catch (err) {
          // qBittorrent unreachable etc.: leave it downloading and try again next time.
          this.o.log?.warn({ id: row.id, err: String(err) }, 'Couldn’t check download');
        }
      }
    } finally {
      this.watching = false;
    }
  }

  /** Step 3: file the book into the library and ask Audiobookshelf to scan. */
  private async importFinished(id: number, qbSavePath: string): Promise<void> {
    const row = this.o.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as Row;
    const req = toRequest(row);
    this.update(id, { status: 'importing', progress: 1, eta_seconds: null });
    try {
      const { dir: library, absLibraryId: libraryId } = this.libraryFor(row.user_id, req.kind);
      if (!library) throw new RequestError('This profile has no library folder for this kind of book.');

      const saveDir = this.localPath(qbSavePath);
      const names = (await this.o.qb.files(row.info_hash!)).map((f) => f.name);
      const files = chooseFiles(req.kind, saveDir, names);
      if (files.length === 0) {
        throw new RequestError(`The download has no ${req.kind === 'ebook' ? 'ebook' : 'audio'} files Lectern recognises.`);
      }

      const result = await importBook({ fetch: this.o.fetch, library, book: req.book, files });
      let message: string | null = result.alreadyThere ? 'Already in your library, so nothing was changed.' : null;
      if (!result.alreadyThere && result.copied > 0) {
        message = 'Copied rather than linked (the download and library are on different drives), so it uses extra space.';
      }

      if (libraryId && this.o.abs.isConfigured()) {
        try {
          await this.o.abs.scanLibrary(libraryId);
        } catch (err) {
          message = `Filed, but Audiobookshelf’s scan didn’t start: ${(err as Error).message}`;
        }
      }

      this.update(id, { status: 'done', library_path: result.folder, message });
      this.o.log?.info({ id, folder: result.folder, linked: result.linked, copied: result.copied }, 'Imported');
    } catch (err) {
      this.fail(id, err);
    }
  }

  // ── Helpers ──

  /** qBittorrent's path for a folder → the same folder as Lectern sees it. */
  private localPath(qbPath: string): string {
    const { pathFrom, pathTo } = this.config.qbittorrent;
    if (pathFrom && pathTo && qbPath.startsWith(pathFrom)) {
      return path.join(pathTo, qbPath.slice(pathFrom.length));
    }
    return qbPath;
  }

  private fail(id: number, err: unknown): void {
    const known = err instanceof RequestError || err instanceof MamError || err instanceof QbError || err instanceof TorrentFileError;
    const fsCode = (err as NodeJS.ErrnoException).code;
    const message = known
      ? (err as Error).message
      : fsCode === 'EACCES'
        ? 'Lectern isn’t allowed to write to the library folder. Check its permissions.'
        : `Something went wrong: ${(err as Error).message}`;
    this.o.log?.warn({ id, err: String(err) }, 'Request failed');
    this.update(id, { status: 'failed', message });
  }

  private update(
    id: number,
    changes: Partial<Pick<Row, 'status' | 'progress' | 'eta_seconds' | 'message' | 'library_path'>>,
  ): void {
    const keys = Object.keys(changes) as Array<keyof typeof changes>;
    if (keys.length === 0) return;
    const sets = [...keys.map((k) => `${k} = @${k}`), 'updated_at = @updated_at'].join(', ');
    this.o.db
      .prepare(`UPDATE requests SET ${sets} WHERE id = @id`)
      .run({ ...changes, id, updated_at: new Date().toISOString() });
  }
}
