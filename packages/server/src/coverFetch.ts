// Fetching book covers safely.
//
// Covers come from a short list of known book-cover sites, over https. Every
// redirect is checked against the same list, so a cover address can't be used
// to make Lectern fetch something else (like a service on the home network).
import { USER_AGENT, type FetchFn } from './http.js';

const ALLOWED_HOSTS = [
  'm.media-amazon.com',
  'images-na.ssl-images-amazon.com',
  'books.google.com',
  'books.googleusercontent.com',
  'covers.openlibrary.org',
  'archive.org', // Open Library covers redirect to archive.org's storage servers
];

const MAX_REDIRECTS = 3;

export function isAllowedCover(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export interface CoverImage {
  data: Buffer;
  contentType: string;
}

/** Download a cover image. Throws if it isn't an allowed image or is larger than maxBytes. */
export async function fetchCover(fetchFn: FetchFn, url: string, maxBytes: number): Promise<CoverImage> {
  let address = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedCover(address)) throw new Error('not an allowed cover address');
    const res = await fetchFn(address, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error(`cover redirected without an address (${res.status})`);
      address = new URL(next, address).toString();
      continue;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !contentType.startsWith('image/')) throw new Error(`cover answered ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('cover too large');
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) throw new Error('cover too large');
    return { data, contentType };
  }
  throw new Error('cover redirected too many times');
}
