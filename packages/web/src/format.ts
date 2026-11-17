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
