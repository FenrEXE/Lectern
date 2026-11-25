// Languages, as each source writes them, and matching author names strictly.
import { normalizeText } from './match.js';

export interface Language {
  /** Lectern's id, also Audible's spelling ("english"). */
  id: string;
  label: string;
  /** Google Books / ISO 639-1 code ("en"). */
  iso: string;
  /** MAM's lang_code ("ENG"). */
  mam: string;
}

/** The languages a profile can pick. "any" (not listed) turns the filter off. */
export const LANGUAGES: Language[] = [
  { id: 'english', label: 'English', iso: 'en', mam: 'ENG' },
  { id: 'spanish', label: 'Spanish', iso: 'es', mam: 'SPA' },
  { id: 'german', label: 'German', iso: 'de', mam: 'GER' },
  { id: 'french', label: 'French', iso: 'fr', mam: 'FRE' },
  { id: 'italian', label: 'Italian', iso: 'it', mam: 'ITA' },
  { id: 'portuguese', label: 'Portuguese', iso: 'pt', mam: 'POR' },
  { id: 'dutch', label: 'Dutch', iso: 'nl', mam: 'DUT' },
  { id: 'japanese', label: 'Japanese', iso: 'ja', mam: 'JPN' },
];

export const ANY_LANGUAGE = 'any';

/** Turn whatever a source says ("english", "en", "en-GB", "ENG") into Lectern's id. */
export function languageId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const short = v.split(/[-_]/)[0]!;
  const found = LANGUAGES.find((l) => l.id === v || l.iso === short || l.mam.toLowerCase() === v);
  return found?.id ?? v;
}

/**
 * Whether a book in `bookLanguage` should show for someone who wants `wanted`.
 * Books whose language isn't known are kept: better one stray than a missing book.
 */
export function languageMatches(bookLanguage: string | undefined, wanted: string): boolean {
  if (wanted === ANY_LANGUAGE || !bookLanguage) return true;
  return languageId(bookLanguage) === wanted;
}

/**
 * An author name in a form where only real differences remain: case, accents
 * and punctuation are ignored, and initials are joined, so "R.J. Knight",
 * "R. J. Knight" and "rj knight" are the same, but "R. Knight" isn't.
 */
export function authorKey(name: string): string {
  const words = normalizeText(name).split(' ').filter(Boolean);
  const out: string[] = [];
  let initials = '';
  for (const w of words) {
    if (w.length === 1) {
      initials += w;
      continue;
    }
    if (initials) out.push(initials);
    initials = '';
    out.push(w);
  }
  if (initials) out.push(initials);
  return out.join(' ');
}

export function sameAuthor(a: string, b: string): boolean {
  return authorKey(a) === authorKey(b);
}
