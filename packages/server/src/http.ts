// A small wrapper around fetch for talking to outside services:
// a timeout, a clear User-Agent, and readable errors.

/** The fetch function. Passed in so tests can supply a fake one. */
export type FetchFn = typeof fetch;

export const USER_AGENT = 'Lectern (self-hosted book app)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** GET a URL and parse its JSON, giving up after `timeoutMs`. */
export async function getJson(
  fetchFn: FetchFn,
  url: string,
  { timeoutMs = 10_000, headers = {} }: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new HttpError(`Couldn't reach ${new URL(url).host}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    // Keep the start of the body: it usually says why (e.g. "Quota exceeded").
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    throw new HttpError(`${new URL(url).host} answered ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  return res.json();
}

/** Strip HTML tags and tidy whitespace, for descriptions that arrive as HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
