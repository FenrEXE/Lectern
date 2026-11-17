// Book lookups from Audible's public catalogue. No account needed.
// Audible is very forgiving of typos and knows series and book numbers,
// which makes it the best first stop for audiobooks.
import type { Book } from '@lectern/shared';
import { getJson, stripHtml, type FetchFn } from '../http.js';

export const AUDIBLE_HOSTS: Record<string, string> = {
  us: 'api.audible.com',
  uk: 'api.audible.co.uk',
  ca: 'api.audible.ca',
  au: 'api.audible.com.au',
  de: 'api.audible.de',
  fr: 'api.audible.fr',
  it: 'api.audible.it',
  es: 'api.audible.es',
  in: 'api.audible.in',
  jp: 'api.audible.co.jp',
};

export interface AudibleBook extends Book {
  asin: string;
}

export async function searchAudible(fetchFn: FetchFn, query: string, region = 'us'): Promise<AudibleBook[]> {
  const host = AUDIBLE_HOSTS[region] ?? AUDIBLE_HOSTS.us;
  const params = new URLSearchParams({
    keywords: query,
    num_results: '20',
    products_sort_by: 'Relevance',
    response_groups: 'contributors,product_desc,product_attrs,media,series',
    image_sizes: '500',
  });
  const json = await getJson(fetchFn, `https://${host}/1.0/catalog/products?${params}`);
  return parseAudible(json);
}

// ── Parsing ──
// Audible's answers aren't documented, so every field is checked before use.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const names = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((p) => (isObj(p) ? str(p.name) : undefined)).filter((n): n is string => !!n) : [];

export function parseAudible(json: unknown): AudibleBook[] {
  if (!isObj(json) || !Array.isArray(json.products)) return [];
  const books: AudibleBook[] = [];
  for (const p of json.products) {
    if (!isObj(p)) continue;
    const asin = str(p.asin);
    const title = str(p.title);
    if (!asin || !title) continue;

    const series = Array.isArray(p.series)
      ? p.series
          .filter(isObj)
          .map((s) => ({ name: str(s.title), number: str(s.sequence) }))
          .filter((s): s is { name: string; number: string | undefined } => !!s.name)
          .map((s) => (s.number ? s : { name: s.name }))
      : [];

    const images = isObj(p.product_images) ? p.product_images : {};
    const cover = str(images['500']) ?? str(Object.values(images)[0]);
    const date = str(p.release_date) ?? str(p.issue_date);
    const summary = str(p.publisher_summary) ?? str(p.merchandising_summary);
    const minutes = typeof p.runtime_length_min === 'number' ? p.runtime_length_min : undefined;

    books.push({
      asin,
      title,
      subtitle: str(p.subtitle),
      authors: names(p.authors),
      narrators: names(p.narrators),
      series: series.length ? series : undefined,
      description: summary ? stripHtml(summary) : undefined,
      publishedYear: date ? Number(date.slice(0, 4)) || undefined : undefined,
      durationMinutes: minutes,
      coverUrl: cover,
    });
  }
  return books;
}
