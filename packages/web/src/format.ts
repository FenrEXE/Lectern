// Small display helpers.
import type { SeriesPosition } from '@lectern/shared';

/** "Mistborn, Book 2" or just "Mistborn". */
export function seriesLabel(series?: SeriesPosition[]): string | undefined {
  const s = series?.[0];
  if (!s) return undefined;
  return s.number ? `${s.name}, Book ${s.number}` : s.name;
}

/** 1490 → "24h 50m" */
export function duration(minutes?: number): string | undefined {
  if (!minutes) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "A, B and C" */
export function joinNames(names?: string[]): string {
  if (!names || names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A cover address served through Lectern: shrunk to a small WebP and cached,
 * so lists load fast. Widths are rounded up to 120, 300 or 600.
 */
export function coverSrc(url: string | undefined, width = 300): string | undefined {
  if (!url) return undefined;
  return `/api/cover?${new URLSearchParams({ u: url, w: String(width) })}`;
}

/** "Brandon Sanderson" → "BS" */
export function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** 1536 → "1.5 KiB", the way MAM shows sizes. */
export function bytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** "just now", "12 min ago", "3 h ago". */
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
