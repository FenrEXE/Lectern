// Filing a finished download into the library, so Audiobookshelf has nothing to guess:
//
//   <library>/<Author>/<Series>/Book <N> - <Title>/
//       <the audio or ebook files>      hardlinked, so seeding keeps working
//       metadata.json                   title, series, number, ASIN/ISBN...
//       cover.jpg
//
// Hardlinks take no extra space and need the download and the library on the
// same drive. If they aren't, the files are copied instead.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Book, MediaKind } from '@lectern/shared';
import { USER_AGENT, type FetchFn } from '../http.js';

/** File types worth filing, per kind. Everything else in a torrent (nfo, txt...) is left behind. */
export const MEDIA_TYPES: Record<MediaKind, string[]> = {
  audiobook: ['m4b', 'mp3', 'm4a', 'flac', 'ogg', 'opus', 'aac', 'wma', 'wav'],
  ebook: ['epub', 'azw3', 'azw', 'mobi', 'pdf', 'cbz', 'cbr'],
};

const extension = (file: string) => path.extname(file).slice(1).toLowerCase();

/** Make text safe as a folder name on any system. */
export function safeName(text: string): string {
  const cleaned = text
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    // No leading or trailing dots: ".." must never become a folder name.
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (cleaned || 'Unknown').slice(0, 120).trim();
}

/** The folders for a book, e.g. ["Brandon Sanderson", "Mistborn", "Book 1 - The Final Empire"]. */
export function bookFolders(book: Book): string[] {
  const author = safeName(book.authors[0] ?? 'Unknown Author');
  const series = book.series?.[0];
  if (series) {
    const title = series.number ? `Book ${series.number} - ${book.title}` : book.title;
    return [author, safeName(series.name), safeName(title)];
  }
  return [author, safeName(book.title)];
}

/** One file to file: where it is now, and where it goes inside the book's folder. */
export interface FileToImport {
  source: string;
  /** Path inside the book folder, e.g. "Part 1/01.mp3". */
  relative: string;
}

/**
 * Pick the files worth keeping from a torrent's file list, and drop the
 * torrent's own top folder so they sit directly in the book's folder.
 */
export function chooseFiles(kind: MediaKind, saveDir: string, names: string[]): FileToImport[] {
  const wanted = names.filter((n) => MEDIA_TYPES[kind].includes(extension(n)));
  if (wanted.length === 0) return [];
  const parts = wanted.map((n) => n.split(/[/\\]/));
  // A shared first folder (the torrent's own folder) is dropped.
  const first = parts[0]![0];
  const shared = parts.every((p) => p.length > 1 && p[0] === first);
  const root = path.resolve(saveDir);
  return wanted.map((name, i) => {
    const source = path.resolve(root, name);
    // Never step outside the download folder, whatever the torrent says.
    if (!source.startsWith(root + path.sep)) throw new Error(`Unsafe file path in torrent: ${name}`);
    const rel = (shared ? parts[i]!.slice(1) : parts[i]!).map((p) => safeName(p));
    return { source, relative: path.join(...rel) };
  });
}

/** Hardlink a file; copy it if a link isn't possible (different drives). */
async function linkOrCopy(source: string, target: string): Promise<'linked' | 'copied'> {
  try {
    await fs.link(source, target);
    return 'linked';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP') {
      await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      return 'copied';
    }
    throw err;
  }
}

/** Audiobookshelf's own metadata.json format. It reads this instead of guessing. */
export function absMetadata(book: Book): Record<string, unknown> {
  return {
    title: book.title,
    subtitle: book.subtitle && !/\bbook\s*\d/i.test(book.subtitle) ? book.subtitle : null,
    authors: book.authors,
    narrators: book.narrators ?? [],
    series: (book.series ?? []).map((s) => (s.number ? `${s.name} #${s.number}` : s.name)),
    genres: [],
    tags: [],
    chapters: [],
    publishedYear: book.publishedYear ? String(book.publishedYear) : null,
    publishedDate: null,
    publisher: null,
    description: book.description ?? null,
    isbn: book.isbn ?? null,
    asin: book.asin ?? null,
    language: null,
    explicit: false,
    abridged: false,
  };
}

export interface ImportResult {
  /** The book's folder, relative to the library. */
  folder: string;
  linked: number;
  copied: number;
  alreadyThere: boolean;
  coverSaved: boolean;
}

export async function importBook(opts: {
  fetch: FetchFn;
  library: string;
  book: Book;
  files: FileToImport[];
}): Promise<ImportResult> {
  const folders = bookFolders(opts.book);
  const library = path.resolve(opts.library);
  const target = path.resolve(library, ...folders);
  if (!target.startsWith(library + path.sep)) throw new Error('Unsafe book folder name.');
  const folder = folders.join('/');

  // Something is already there: don't overwrite a book you already have.
  const existing = await fs.readdir(target).catch(() => [] as string[]);
  if (existing.length > 0) {
    return { folder, linked: 0, copied: 0, alreadyThere: true, coverSaved: false };
  }

  let linked = 0;
  let copied = 0;
  for (const file of opts.files) {
    const dest = path.join(target, file.relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if ((await linkOrCopy(file.source, dest)) === 'linked') linked++;
    else copied++;
  }

  await fs.writeFile(path.join(target, 'metadata.json'), JSON.stringify(absMetadata(opts.book), null, 2));
  const coverSaved = opts.book.coverUrl ? await saveCover(opts.fetch, opts.book.coverUrl, target) : false;
  return { folder, linked, copied, alreadyThere: false, coverSaved };
}

/** Download the cover next to the book. A missing cover never fails the import. */
async function saveCover(fetchFn: FetchFn, url: string, dir: string): Promise<boolean> {
  if (!/^https:\/\//.test(url)) return false;
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return false;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 10 * 1024 * 1024) return false;
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    await fs.writeFile(path.join(dir, `cover.${ext}`), data);
    return true;
  } catch {
    return false;
  }
}
