// The one place the web app talks to the Lectern server.
import type {
  AuthorResponse,
  AvailabilityResponse,
  Book,
  DetailsResponse,
  LibraryRequest,
  MamStatsResponse,
  MamTorrent,
  MediaKind,
  MeResponse,
  Profile,
  ProfileLibrary,
  OnMamRequest,
  OnMamResponse,
  ProfilesResponse,
  SearchResponse,
  SeriesResponse,
  StatusResponse,
  SuggestResponse,
} from '@lectern/shared';

/** Called when the server says "please sign in" (e.g. the session expired). */
let onSignedOut: () => void = () => undefined;
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onSignedOut();
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

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(url: string, body: unknown) => request<T>(url, { method: 'PUT', body: JSON.stringify(body) });

// ── Admin panel shapes (mirroring the server) ──

export interface SettingView {
  key: string;
  value: string | null;
  secret: boolean;
  isSet: boolean;
  hint?: string;
  source: 'saved' | 'environment' | 'default';
}

export interface AdminSettings {
  settings: SettingView[];
  options: { showProfiles: boolean };
  /** The VPN interface MAM traffic must use; only set in the environment. */
  mamInterface: string | null;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: string;
  folders: string[];
}

export interface FolderListing {
  path: string;
  parent: string | null;
  folders: string[];
  writable: boolean;
}

export interface ProfileInput {
  name?: string;
  password?: string;
  role?: 'admin' | 'member';
  defaultKind?: MediaKind;
  language?: string;
  libraries?: Partial<Record<MediaKind, ProfileLibrary>>;
}

export const api = {
  // ── Signing in ──
  me: () => request<MeResponse>('/api/auth/me'),
  profiles: () => request<ProfilesResponse>('/api/auth/profiles'),
  setup: (input: { code: string; name: string; password: string; showProfiles: boolean }) =>
    post<MeResponse>('/api/auth/setup', input),
  login: (name: string, password: string) => post<MeResponse>('/api/auth/login', { name, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  updateMe: (changes: { defaultKind?: MediaKind; language?: string; currentPassword?: string; newPassword?: string }) =>
    put<Profile>('/api/me', changes),

  status: () => request<StatusResponse>('/api/status'),
  mamStats: () => request<MamStatsResponse>('/api/mam/stats'),
  refreshMamStats: () => post<MamStatsResponse>('/api/mam/stats/refresh'),

  // ── Finding books ──
  /** Search MAM: one request (or none if cached). Only call on Enter, never while typing. */
  search: (q: string, kind: MediaKind, signal?: AbortSignal, cachedOnly = false) =>
    request<SearchResponse>(`/api/search?${new URLSearchParams({ q, kind, ...(cachedOnly ? { cached: '1' } : {}) })}`, {
      signal,
    }),

  /** Covers and descriptions for found books, from Audible/Google/Open Library (never MAM). */
  details: (kind: MediaKind, books: Array<{ id: string; title: string; author?: string }>) =>
    post<DetailsResponse>('/api/books/details', { kind, books }),

  suggest: (q: string, kind: MediaKind, signal?: AbortSignal) =>
    request<SuggestResponse>(`/api/suggest?${new URLSearchParams({ q, kind })}`, { signal }),

  /** `id` is Audible's author ID, when known: it keeps look-alike names off the page. */
  author: (name: string, kind: MediaKind, id?: string) =>
    request<AuthorResponse>(`/api/author?${new URLSearchParams({ name, kind, ...(id ? { id } : {}) })}`),

  series: (name: string, author: string | undefined, kind: MediaKind, authorId?: string) =>
    request<SeriesResponse>(
      `/api/series?${new URLSearchParams({ name, kind, ...(author ? { author } : {}), ...(author && authorId ? { authorId } : {}) })}`,
    ),

  /** "Check MAM" on an author or series page: one MAM search for all its books. */
  onMam: (request: OnMamRequest) => post<OnMamResponse>('/api/onmam', request),

  availability: (book: Book, kind: MediaKind) =>
    post<AvailabilityResponse>('/api/availability', {
      kind,
      book: { title: book.title, subtitle: book.subtitle, authors: book.authors, series: book.series, isbn: book.isbn },
    }),

  // ── Add to Library ──
  requests: (everyone = false) => request<LibraryRequest[]>(`/api/requests${everyone ? '?all=1' : ''}`),

  addToLibrary: (book: Book, kind: MediaKind, torrent: MamTorrent) =>
    post<LibraryRequest>('/api/requests', {
      kind,
      torrent: { id: torrent.id, title: torrent.title },
      book: {
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors,
        narrators: book.narrators,
        series: book.series,
        description: book.description,
        asin: book.asin,
        isbn: book.isbn,
        publishedYear: book.publishedYear,
        durationMinutes: book.durationMinutes,
        coverUrl: book.coverUrl,
      },
    }),

  retry: (id: number) => post<LibraryRequest>(`/api/requests/${id}/retry`),

  // ── Admin ──
  admin: {
    settings: () => request<AdminSettings>('/api/admin/settings'),
    saveSettings: (changes: { values?: Record<string, string | null>; options?: { showProfiles?: boolean } }) =>
      put<AdminSettings>('/api/admin/settings', changes),
    test: (service: 'mam' | 'qbittorrent' | 'audiobookshelf' | 'google') => post<TestResult>(`/api/admin/test/${service}`),
    absLibraries: () => request<AbsLibrary[]>('/api/admin/abs/libraries'),
    folders: (path: string) => request<FolderListing>(`/api/admin/folders?${new URLSearchParams({ path })}`),
    users: () => request<Profile[]>('/api/admin/users'),
    addUser: (input: ProfileInput) => post<Profile>('/api/admin/users', input),
    updateUser: (id: number, changes: ProfileInput) => put<Profile>(`/api/admin/users/${id}`, changes),
    removeUser: (id: number) => request<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  },
};
