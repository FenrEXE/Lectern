// GET  /api/search?q=...&kind=audiobook    search MAM (one request, or none if cached)
// POST /api/books/details {kind, books}    covers and details for found books (never MAM)
// GET  /api/suggest?q=...&kind=audiobook   book info only, never MAM (author/series pages' search)
// POST /api/availability {book, kind}      find a book from Audible/Google on MAM (author/series pages)
// POST /api/onmam {kind, query, books}     "Check MAM" for a whole author or series page: one search
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  languageMatches,
  type AvailabilityResponse,
  type DetailsResponse,
  type OnMamResponse,
  type SearchResponse,
  type SuggestResponse,
} from '@lectern/shared';
import type { MamClient } from '../mam/client.js';
import { checkAvailability } from '../search/availability.js';
import { bookDetails, MAX_DETAILS } from '../search/details.js';
import { searchMam } from '../search/mamSearch.js';
import { checkOnMam } from '../search/onMam.js';
import { suggestBooks, type SuggestDeps } from '../search/suggest.js';

const kind = z.enum(['audiobook', 'ebook']).default('audiobook');

const suggestQuery = z.object({
  q: z.string().trim().min(2, 'type at least 2 characters').max(200),
  kind,
});
const searchQuery = suggestQuery.extend({ cached: z.literal('1').optional() });

const series = z.object({ name: z.string().min(1).max(300), number: z.string().max(20).optional() });
const availabilityBody = z.object({
  kind,
  book: z.object({
    title: z.string().trim().min(1).max(500),
    subtitle: z.string().max(500).optional(),
    authors: z.array(z.string().max(200)).max(10).default([]),
    series: z.array(series).max(5).optional(),
    isbn: z.string().max(20).optional(),
  }),
});

const detailsBody = z.object({
  kind,
  books: z
    .array(z.object({ id: z.string().max(100), title: z.string().trim().min(1).max(500), author: z.string().max(200).optional() }))
    .max(MAX_DETAILS),
});

const onMamBody = z.object({
  kind,
  query: z.string().trim().min(2).max(300),
  books: z
    .array(
      z.object({
        id: z.string().max(100),
        title: z.string().trim().min(1).max(500),
        subtitle: z.string().max(500).optional(),
        authors: z.array(z.string().max(200)).max(10).default([]),
        series: z.array(series).max(5).optional(),
        isbn: z.string().max(20).optional(),
      }),
    )
    .max(200),
});

export function searchRoutes(app: FastifyInstance, deps: SuggestDeps & { mam: MamClient }): void {
  app.get('/api/search', async (req, reply): Promise<SearchResponse | void> => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    }
    return searchMam({ ...deps, log: req.log }, parsed.data.q, parsed.data.kind, {
      language: req.user!.language,
      cachedOnly: parsed.data.cached === '1',
    });
  });

  app.post('/api/books/details', async (req, reply): Promise<DetailsResponse | void> => {
    const parsed = detailsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad request' });
    return bookDetails({ ...deps, log: req.log }, parsed.data.kind, parsed.data.books);
  });

  app.post('/api/onmam', async (req, reply): Promise<OnMamResponse | void> => {
    const parsed = onMamBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad request' });
    return checkOnMam(deps.mam, parsed.data, parsed.data.kind, { language: req.user!.language });
  });

  app.get('/api/suggest', async (req, reply): Promise<SuggestResponse | void> => {
    const parsed = suggestQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    }
    const result = await suggestBooks({ ...deps, log: req.log }, parsed.data.q, parsed.data.kind);
    // Only books in the profile's language (books of unknown language stay).
    const language = req.user!.language;
    return { ...result, suggestions: result.suggestions.filter((b) => languageMatches(b.language, language)) };
  });

  app.post('/api/availability', async (req, reply): Promise<AvailabilityResponse | void> => {
    const parsed = availabilityBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    }
    return checkAvailability(deps.mam, parsed.data.book, parsed.data.kind);
  });
}
