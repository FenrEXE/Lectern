// The one place the web app talks to the Lectern server.
import type {
  AvailabilityResponse,
  Book,
  HealthResponse,
  MediaKind,
  SuggestResponse,
} from '@lectern/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let message = `${url} answered ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON; keep the generic message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  suggest: (q: string, kind: MediaKind, signal?: AbortSignal) =>
    request<SuggestResponse>(`/api/suggest?${new URLSearchParams({ q, kind })}`, { signal }),

  availability: (book: Book, kind: MediaKind) =>
    request<AvailabilityResponse>('/api/availability', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        book: { title: book.title, subtitle: book.subtitle, authors: book.authors, series: book.series },
      }),
    }),
};
