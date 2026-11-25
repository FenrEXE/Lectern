// Tidy up (admin only): check every book in an Audiobookshelf library against
// Audible, show what would change, and apply only what the admin picks.
//
// A run has three steps, each started by the admin:
//   1. scan  — reads the library and looks each book up on Audible. Changes nothing.
//   2. apply — fixes the picked books in Audiobookshelf (details only; files
//              and folders are never touched). What each book looked like
//              before is saved first.
//   3. undo  — puts every fixed book in the run back as it was.
//
// Audible is asked one book at a time with a short pause, and answers are kept
// for 30 days, so a second scan is quick. MAM is never involved.
import { languageMatches, type TidyBook, type TidyChange, type TidyItem, type TidyRun, type TidyRunResponse, type TidyStatus } from '@lectern/shared';
import type { AbsClient, AbsMetadataUpdate } from '../audiobookshelf/client.js';
import { cached, HOUR } from '../cache.js';
import { readConfig, type ConfigSource } from '../config.js';
import type { Db } from '../db.js';
import type { FetchFn } from '../http.js';
import { audibleByAsin, searchAudibleBy, type AudibleBook } from '../metadata/audible.js';
import { checkAsinMatch, chooseMatch, cleanTitle, diff, toTidyBook } from './propose.js';

const KEEP_LOOKUPS = 30 * 24 * HOUR;
const PAUSE_MS = 250;
const PAGE_SIZE = 100;

export class TidyError extends Error {}

interface RunRow {
  id: number;
  library_id: string;
  library_name: string;
  status: TidyRun['status'];
  total: number;
  scanned: number;
  message: string | null;
  created_at: string;
}

interface ItemRow {
  id: number;
  run_id: number;
  item_id: string;
  path: string | null;
  status: TidyStatus;
  reason: string | null;
  current: string;
  proposed: string | null;
  changes: string;
  before: string | null;
  applied_at: string | null;
  undone_at: string | null;
  error: string | null;
}

const toItem = (r: ItemRow): TidyItem => ({
  id: r.id,
  itemId: r.item_id,
  path: r.path ?? undefined,
  status: r.status,
  reason: r.reason ?? undefined,
  current: JSON.parse(r.current) as TidyBook,
  proposed: r.proposed ? (JSON.parse(r.proposed) as TidyBook) : undefined,
  changes: JSON.parse(r.changes) as TidyChange[],
  appliedAt: r.applied_at ?? undefined,
  undoneAt: r.undone_at ?? undefined,
  error: r.error ?? undefined,
});

export interface TidyDeps {
  db: Db;
  abs: AbsClient;
  fetch: FetchFn;
  config: ConfigSource;
  log?: { warn: (obj: object, msg: string) => void };
  sleep?: (ms: number) => Promise<void>;
}

export class TidyService {
  private readonly sleep: (ms: number) => Promise<void>;
  /** The job currently running (scan, apply or undo), so tests can wait for it. */
  running?: Promise<void>;

  constructor(private readonly o: TidyDeps) {
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** A job can't survive a restart; say so instead of looking stuck forever. */
  markInterrupted(): void {
    this.o.db
      .prepare(
        `UPDATE tidy_runs SET status = CASE WHEN status = 'scanning' THEN 'failed' ELSE 'ready' END,
           message = 'Lectern restarted while this was running. Books already fixed stay fixed; you can apply or scan again.',
           updated_at = ? WHERE status IN ('scanning', 'applying', 'undoing')`,
      )
      .run(new Date().toISOString());
  }

  /** The newest run and its books. */
  latest(): TidyRunResponse {
    const row = this.o.db.prepare('SELECT * FROM tidy_runs ORDER BY id DESC LIMIT 1').get() as RunRow | undefined;
    if (!row) return { run: null, items: [] };
    const items = (this.o.db.prepare('SELECT * FROM tidy_items WHERE run_id = ? ORDER BY id').all(row.id) as ItemRow[]).map(toItem);
    return { run: this.toRun(row), items };
  }

  private toRun(r: RunRow): TidyRun {
    const counts = { fix: 0, unsure: 0, ok: 0, 'not-found': 0, error: 0 } as Record<TidyStatus, number>;
    for (const c of this.o.db.prepare('SELECT status, COUNT(*) AS n FROM tidy_items WHERE run_id = ? GROUP BY status').all(r.id) as Array<{
      status: TidyStatus;
      n: number;
    }>) {
      counts[c.status] = c.n;
    }
    const applied = (
      this.o.db.prepare('SELECT COUNT(*) AS n FROM tidy_items WHERE run_id = ? AND applied_at IS NOT NULL AND undone_at IS NULL').get(r.id) as {
        n: number;
      }
    ).n;
    return {
      id: r.id,
      libraryId: r.library_id,
      libraryName: r.library_name,
      status: r.status,
      total: r.total,
      scanned: r.scanned,
      message: r.message ?? undefined,
      createdAt: r.created_at,
      counts,
      applied,
    };
  }

  private busy(): boolean {
    return !!this.o.db.prepare("SELECT 1 FROM tidy_runs WHERE status IN ('scanning', 'applying', 'undoing')").get();
  }

  private setRun(id: number, fields: Partial<Pick<RunRow, 'status' | 'total' | 'scanned' | 'message'>>): void {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`);
    this.o.db.prepare(`UPDATE tidy_runs SET ${[...sets, 'updated_at = @now'].join(', ')} WHERE id = @id`).run({
      ...fields,
      now: new Date().toISOString(),
      id,
    });
  }

  // ── 1. Scan ──

  async startScan(libraryId: string, options: { language: string }): Promise<TidyRun> {
    if (this.busy()) throw new TidyError('Tidy up is already working on something. Wait for it to finish.');
    const library = (await this.o.abs.libraries()).find((l) => l.id === libraryId);
    if (!library) throw new TidyError('Audiobookshelf doesn’t have that library (or this API key can’t see it).');
    if (library.mediaType !== 'book') throw new TidyError('Tidy up only works on book libraries, not podcasts.');
    const now = new Date().toISOString();
    const { lastInsertRowid } = this.o.db
      .prepare("INSERT INTO tidy_runs (library_id, library_name, status, created_at, updated_at) VALUES (?, ?, 'scanning', ?, ?)")
      .run(library.id, library.name, now, now);
    const runId = Number(lastInsertRowid);
    this.running = this.scan(runId, library.id, options.language).catch((err) => {
      this.setRun(runId, { status: 'failed', message: (err as Error).message });
    });
    return this.latest().run!;
  }

  private async scan(runId: number, libraryId: string, language: string): Promise<void> {
    const insert = this.o.db.prepare(
      `INSERT INTO tidy_items (run_id, item_id, path, status, reason, current, proposed, changes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let scanned = 0;
    for (let page = 0; ; page++) {
      const { items, total } = await this.o.abs.libraryItems(libraryId, page, PAGE_SIZE);
      this.setRun(runId, { total });
      for (const item of items) {
        let status: TidyStatus;
        let reason: string | undefined;
        let proposed: TidyBook | undefined;
        let changes: TidyChange[] = [];
        if (item.isMissing) {
          status = 'error';
          reason = 'Audiobookshelf says this book’s files are missing.';
        } else {
          try {
            const found = await this.lookUp(item.book, language);
            status = found.status;
            reason = found.reason;
            if (found.book) {
              proposed = toTidyBook(found.book);
              changes = diff(item.book, proposed);
              if (changes.length === 0) status = 'ok';
            }
          } catch (err) {
            status = 'error';
            reason = `Couldn’t check: ${(err as Error).message}`;
          }
        }
        insert.run(runId, item.id, item.relPath ?? null, status, reason ?? null, JSON.stringify(item.book), proposed ? JSON.stringify(proposed) : null, JSON.stringify(changes));
        this.setRun(runId, { scanned: ++scanned });
      }
      if (items.length < PAGE_SIZE || scanned >= total) break;
    }
    this.setRun(runId, { status: 'ready', message: null });
  }

  /** Find the book on Audible: by its ASIN if it has one, otherwise by title and author. */
  private async lookUp(book: TidyBook, language: string): Promise<{ book?: AudibleBook; status: TidyStatus; reason?: string }> {
    const region = readConfig(this.o.config).audibleRegion;
    if (book.asin) {
      const byAsin = await cached(this.o.db, `tidy:asin:${region}:${book.asin}`, KEEP_LOOKUPS, async () => {
        await this.sleep(PAUSE_MS);
        return (await audibleByAsin(this.o.fetch, book.asin!, region)) ?? null;
      });
      if (byAsin) return { book: byAsin, ...checkAsinMatch(book, byAsin) };
    }
    if (!book.title) return { status: 'not-found', reason: 'This book has no title in Audiobookshelf.' };
    const title = cleanTitle(book.title);
    const author = book.authors[0];
    const candidates = await cached(this.o.db, `tidy:search:${region}:${title}|${author ?? ''}`.toLowerCase(), KEEP_LOOKUPS, async () => {
      await this.sleep(PAUSE_MS);
      return searchAudibleBy(this.o.fetch, { title, author }, region, 10);
    });
    // Prefer editions in the admin's language; only look at others if there are none.
    const inLanguage = candidates.filter((c) => languageMatches(c.language, language));
    return chooseMatch(book, inLanguage.length ? inLanguage : candidates) as { book?: AudibleBook; status: TidyStatus; reason?: string };
  }

  // ── 2. Apply ──

  startApply(runId: number, itemIds: number[]): TidyRun {
    const run = this.runRow(runId);
    if (run.status !== 'ready') throw new TidyError('This scan isn’t ready to apply.');
    if (this.busy()) throw new TidyError('Tidy up is already working on something. Wait for it to finish.');
    const wanted = new Set(itemIds);
    const rows = (
      this.o.db
        .prepare("SELECT * FROM tidy_items WHERE run_id = ? AND status IN ('fix', 'unsure') AND applied_at IS NULL")
        .all(runId) as ItemRow[]
    ).filter((r) => wanted.has(r.id));
    if (rows.length === 0) throw new TidyError('Pick at least one book to fix.');
    this.setRun(runId, { status: 'applying', message: null });
    this.running = this.applyAll(rows).finally(() => this.setRun(runId, { status: 'ready' }));
    return this.toRun(this.runRow(runId));
  }

  private async applyAll(rows: ItemRow[]): Promise<void> {
    const done = this.o.db.prepare('UPDATE tidy_items SET before = ?, applied_at = ?, undone_at = NULL, error = NULL WHERE id = ?');
    const failed = this.o.db.prepare('UPDATE tidy_items SET error = ? WHERE id = ?');
    for (const row of rows) {
      const item = toItem(row);
      try {
        // Read it fresh: what's saved as "before" is exactly what gets restored on undo.
        const fresh = await this.o.abs.item(item.itemId);
        const update = metadataFor(item.changes, item.proposed!);
        if (Object.keys(update).length) await this.o.abs.updateMetadata(item.itemId, update);
        if (item.changes.some((c) => c.field === 'cover') && item.proposed?.coverUrl && !fresh.book.hasCover) {
          await this.o.abs.setCoverFromUrl(item.itemId, item.proposed.coverUrl);
        }
        done.run(JSON.stringify(fresh.book), new Date().toISOString(), row.id);
      } catch (err) {
        failed.run((err as Error).message, row.id);
      }
      await this.sleep(PAUSE_MS);
    }
  }

  // ── 3. Undo ──

  startUndo(runId: number): TidyRun {
    const run = this.runRow(runId);
    if (run.status !== 'ready') throw new TidyError('This run can’t be undone right now.');
    if (this.busy()) throw new TidyError('Tidy up is already working on something. Wait for it to finish.');
    const rows = this.o.db
      .prepare('SELECT * FROM tidy_items WHERE run_id = ? AND applied_at IS NOT NULL AND undone_at IS NULL')
      .all(runId) as ItemRow[];
    if (rows.length === 0) throw new TidyError('Nothing in this run has been fixed, so there’s nothing to undo.');
    this.setRun(runId, { status: 'undoing', message: null });
    this.running = this.undoAll(rows).finally(() => this.setRun(runId, { status: 'ready' }));
    return this.toRun(this.runRow(runId));
  }

  private async undoAll(rows: ItemRow[]): Promise<void> {
    const undone = this.o.db.prepare('UPDATE tidy_items SET undone_at = ?, error = NULL WHERE id = ?');
    const failed = this.o.db.prepare('UPDATE tidy_items SET error = ? WHERE id = ?');
    for (const row of rows) {
      const item = toItem(row);
      try {
        const before = JSON.parse(row.before!) as TidyBook;
        const update = metadataFor(item.changes, before, true);
        if (Object.keys(update).length) await this.o.abs.updateMetadata(item.itemId, update);
        // A cover was only ever added to books that had none, so undo removes it.
        if (item.changes.some((c) => c.field === 'cover') && !before.hasCover) await this.o.abs.removeCover(item.itemId);
        undone.run(new Date().toISOString(), row.id);
      } catch (err) {
        failed.run(`Undo didn’t work: ${(err as Error).message}`, row.id);
      }
      await this.sleep(PAUSE_MS);
    }
  }

  private runRow(runId: number): RunRow {
    const row = this.o.db.prepare('SELECT * FROM tidy_runs WHERE id = ?').get(runId) as RunRow | undefined;
    if (!row) throw new TidyError('No such Tidy up run.');
    return row;
  }
}

/**
 * The Audiobookshelf update for the changed fields only, taking values from
 * `source` (the proposal when applying, the saved "before" when undoing).
 * When undoing, empty values are written back as empty.
 */
export function metadataFor(changes: TidyChange[], source: TidyBook, undoing = false): AbsMetadataUpdate {
  const update: AbsMetadataUpdate = {};
  for (const { field } of changes) {
    switch (field) {
      case 'title':
        update.title = source.title;
        break;
      case 'authors':
        update.authors = source.authors.map((name) => ({ name }));
        break;
      case 'narrators':
        update.narrators = source.narrators;
        break;
      case 'series':
        update.series = source.series.map((s) => ({ name: s.name, sequence: s.number ?? null }));
        break;
      case 'asin':
        update.asin = source.asin ?? (undoing ? null : undefined);
        break;
      case 'publishedYear':
        update.publishedYear = source.publishedYear ? String(source.publishedYear) : undoing ? null : undefined;
        break;
      default:
        break;
    }
  }
  return Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) as AbsMetadataUpdate;
}

