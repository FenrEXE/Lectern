// Turning MAM's search answers into Lectern's own shape.
//
// MAM packs authors, narrators and series into JSON *strings*, e.g.
//   author_info: '{"123":"Brandon Sanderson"}'
//   series_info: '{"456":["Mistborn","1"]}'
// so each is unpacked carefully; anything unexpected is skipped, not fatal.
import type { MamTorrent, SeriesPosition } from '@lectern/shared';

export type ParsedTorrent = Omit<MamTorrent, 'matchScore'>;

export class MamError extends Error {
  constructor(
    readonly kind: 'session-expired' | 'vpn-down' | 'not-configured' | 'daily-limit' | 'error',
    message: string,
  ) {
    super(message);
    this.name = 'MamError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const flag = (v: unknown): boolean => v === true || v === 1 || v === '1';

/** Unpack a value that may be a JSON string, an object or a list. */
function unpack(v: unknown): unknown {
  if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return v;
}

/** '{"1":"A","2":"B"}' → ["A", "B"] */
export function parseNames(v: unknown): string[] {
  const value = unpack(v);
  const list = isObj(value) ? Object.values(value) : Array.isArray(value) ? value : [value];
  return list.map(str).filter((s): s is string => !!s);
}

/** '{"9":["Mistborn","1"]}' → [{ name: "Mistborn", number: "1" }] */
export function parseSeries(v: unknown): SeriesPosition[] {
  const value = unpack(v);
  const entries = isObj(value) ? Object.values(value) : Array.isArray(value) ? [value] : [];
  const out: SeriesPosition[] = [];
  for (const e of entries) {
    const name = Array.isArray(e) ? str(e[0]) : str(e);
    const number = Array.isArray(e) ? str(e[1]) : undefined;
    if (name) out.push(number ? { name, number } : { name });
  }
  return out;
}

/** 6324306932 → "5.9 GiB". MAM sends size as a number of bytes in a string. */
export function formatSize(size: unknown): string | undefined {
  const text = str(size);
  if (!text) return undefined;
  if (!/^\d+$/.test(text)) return text; // already human-readable
  let value = Number(text);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Series numbers can be one book ("2", "13.5") or several ("01-16, 13.5").
 * Returns the ranges covered, e.g. [[1, 16], [13.5, 13.5]]. Empty if unreadable.
 */
export function seriesRanges(number?: string): Array<[number, number]> {
  if (!number) return [];
  const ranges: Array<[number, number]> = [];
  for (const part of number.split(/[,&]|\band\b/)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*$/.exec(part);
    if (m) ranges.push([Number(m[1]), Number(m[2] ?? m[1])]);
  }
  return ranges;
}

/** True when a series number covers more than one book. */
const isPack = (number?: string): boolean => {
  const r = seriesRanges(number);
  return r.length > 1 || r.some(([a, b]) => b > a);
};

export function parseTorrent(item: unknown): ParsedTorrent | undefined {
  if (!isObj(item)) return undefined;
  const id = str(item.id);
  const title = str(item.title) ?? str(item.name);
  if (!id || !title) return undefined;
  const series = parseSeries(item.series_info);
  const formats = [...new Set((str(item.filetype) ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean))];
  return {
    id,
    title,
    authors: parseNames(item.author_info),
    narrators: parseNames(item.narrator_info),
    series,
    formats,
    size: formatSize(item.size),
    seeders: num(item.seeders),
    leechers: num(item.leechers),
    category: str(item.catname),
    language: str(item.lang_code),
    added: str(item.added),
    isbn: str(item.isbn)?.replace(/[^\dX]/gi, '') || undefined,
    freeleech: flag(item.free) || flag(item.personal_freeleech),
    vip: flag(item.vip),
    snatched: flag(item.my_snatched),
    collection: series.some((s) => isPack(s.number)) || /\bbooks?\s*\d+\s*[-–]\s*\d+/i.test(title),
  };
}

/**
 * Read a whole search answer. MAM reports "no results" as an error message,
 * which is treated as an empty list. Session problems become 'session-expired'.
 */
export function parseSearchResponse(json: unknown): ParsedTorrent[] {
  if (!isObj(json)) throw new MamError('error', 'MAM sent an answer Lectern doesn’t understand.');
  const error = str(json.error);
  if (error) {
    if (/nothing returned/i.test(error)) return [];
    if (/session|log ?in|logged|cookie|asn|unauthori[sz]ed/i.test(error)) {
      throw new MamError('session-expired', `MAM rejected the session: ${error}`);
    }
    throw new MamError('error', `MAM said: ${error}`);
  }
  if (!Array.isArray(json.data)) return [];
  return json.data.map(parseTorrent).filter((t): t is ParsedTorrent => !!t);
}

/**
 * Read the account summary from MAM's jsonLoad.php. Byte counts are used
 * (the "ratio" and "uploaded" fields are formatted for display). "unsat" has
 * moved under "snatch_summary" before, so both places are checked.
 */
export function parseAccountStats(json: unknown): { ratio: number | null; uploadedBytes: number; downloadedBytes: number; unsat: { count: number; limit: number } | null } {
  if (!isObj(json)) throw new MamError('error', 'MAM sent something that isn’t account details.');
  if (typeof json.error === 'string') throw new MamError('error', `MAM: ${json.error}`);
  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  };
  // MAM's API page documents only the formatted values ("5.125 TiB"); the
  // exact *_bytes counts are also sent today. Prefer exact, fall back to formatted.
  const uploadedBytes = num(json.uploaded_bytes) ?? sizeToBytes(json.uploaded);
  const downloadedBytes = num(json.downloaded_bytes) ?? sizeToBytes(json.downloaded);
  if (uploadedBytes === undefined || downloadedBytes === undefined) {
    throw new MamError('error', 'MAM’s account details didn’t include upload and download totals.');
  }
  const summary = isObj(json.snatch_summary) ? json.snatch_summary : {};
  const unsatRaw = isObj(summary.unsat) ? summary.unsat : isObj(json.unsat) ? json.unsat : undefined;
  const count = num(unsatRaw?.count);
  const limit = num(unsatRaw?.limit);
  return {
    ratio: downloadedBytes > 0 ? uploadedBytes / downloadedBytes : (num(json.ratio) ?? null),
    uploadedBytes,
    downloadedBytes,
    unsat: count !== undefined && limit !== undefined ? { count, limit } : null,
  };
}

/** "5.125 TiB" → bytes. MAM uses binary units (KiB, MiB...). */
function sizeToBytes(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^([\d.,]+)\s*([KMGTPE]?)i?B$/i.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ''));
  const power = ' KMGTPE'.indexOf((m[2] || ' ').toUpperCase());
  return Number.isFinite(n) && power >= 0 ? Math.round(n * 1024 ** power) : undefined;
}
