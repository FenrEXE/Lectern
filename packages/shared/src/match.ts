// Typo-tolerant text matching. Pure functions, no dependencies.
//
// The idea: split text into words, then ask "for each word the person typed,
// how close is the nearest word in this book's title/author/series?". Small
// typos ("sandersen" vs "sanderson") still score highly; unrelated words don't.

/**
 * Normalise text for comparing titles and names: lower case, no accents,
 * no punctuation, single spaces. "The Well of Ascension!" → "the well of ascension".
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Words too common to tell books apart.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'by']);

/** Normalised words, without stop words (unless that would leave nothing). */
export function words(text: string): string[] {
  const all = normalizeText(text).split(' ').filter(Boolean);
  const kept = all.filter((w) => !STOP_WORDS.has(w));
  return kept.length > 0 ? kept : all;
}

/** Edit distance allowing swapped neighbours ("teh" → "the" costs 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1, // delete
        d[i]![j - 1]! + 1, // insert
        d[i - 1]![j - 1]! + cost, // substitute
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1); // swap
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/** How alike two single words are, 0–1. */
export function wordSimilarity(typed: string, candidate: string): number {
  if (typed === candidate) return 1;
  // Typing the start of a word counts ("sand" → "sanderson"), but only from 3 letters.
  if (typed.length >= 3 && candidate.startsWith(typed)) return 0.9;
  // Numbers must match exactly: book 2 isn't book 3.
  if (/^\d+$/.test(typed) || /^\d+$/.test(candidate)) return 0;
  const longest = Math.max(typed.length, candidate.length);
  const sim = 1 - editDistance(typed, candidate) / longest;
  // Very short words with a typo are too ambiguous to count.
  if (longest <= 3 && sim < 1) return 0;
  return sim >= 0.6 ? sim : 0;
}

/** The candidate word nearest to `typed`, and how near it is. */
export function closestWord(typed: string, candidates: string[]): { word?: string; similarity: number } {
  let best: { word?: string; similarity: number } = { similarity: 0 };
  for (const c of candidates) {
    const s = wordSimilarity(typed, c);
    if (s > best.similarity) best = { word: c, similarity: s };
    if (s === 1) break;
  }
  return best;
}

/**
 * How much of what was typed is found in `text`, 0–1.
 * 1 means every typed word appears (exactly). Extra words in `text` don't hurt.
 */
export function coverage(query: string, text: string): number {
  const typed = words(query);
  if (typed.length === 0) return 0;
  const haystack = words(text);
  const total = typed.reduce((sum, w) => sum + closestWord(w, haystack).similarity, 0);
  return total / typed.length;
}

/**
 * How alike two titles are, in both directions, 0–1.
 * "The Final Empire" vs "Mistborn: The Final Empire" scores well; different books don't.
 */
export function titleSimilarity(a: string, b: string): number {
  return (coverage(a, b) + coverage(b, a)) / 2;
}

/**
 * Rewrite the query with each typo replaced by the word it most likely meant,
 * using words from `reference` (e.g. the top result's title and author).
 * Returns undefined when nothing needed correcting.
 */
export function correctQuery(query: string, reference: string): string | undefined {
  const typed = normalizeText(query).split(' ').filter(Boolean);
  const vocab = normalizeText(reference).split(' ').filter(Boolean);
  let changed = false;
  const fixed = typed.map((w) => {
    const { word, similarity } = closestWord(w, vocab);
    // Only fix real typos: close but not identical, and not a prefix match.
    if (word && similarity >= 0.7 && similarity < 0.9) {
      changed = true;
      return word;
    }
    return w;
  });
  return changed ? fixed.join(' ') : undefined;
}
