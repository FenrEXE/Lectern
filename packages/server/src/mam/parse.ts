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
    readonly kind: 'session-expired' | 'vpn-down' | 'not-configured' | 'error',
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

export function parseTorrent(item: unknown): ParsedTorrent | undefined {
  if (!isObj(item)) return undefined;
  const id = str(item.id);
  const title = str(item.title) ?? str(item.name);
  if (!id || !title) return undefined;
  return {
    id,
    title,
    authors: parseNames(item.author_info),
    narrators: parseNames(item.narrator_info),
    series: parseSeries(item.series_info),
    format: str(item.filetype)?.toLowerCase(),
    size: str(item.size),
    seeders: num(item.seeders),
    leechers: num(item.leechers),
    category: str(item.catname),
    added: str(item.added),
    freeleech: flag(item.free) || flag(item.personal_freeleech) || flag(item.fl_vip),
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
