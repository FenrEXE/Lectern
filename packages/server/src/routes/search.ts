// GET  /api/suggest?q=...&kind=audiobook   "Did you mean": book info only, never MAM
// POST /api/availability {book, kind}      the chosen book's matches on MAM
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AvailabilityResponse, SuggestResponse } from '@lectern/shared';
import type { MamClient } from '../mam/client.js';
import { checkAvailability } from '../search/availability.js';
import { suggestBooks, type SuggestDeps } from '../search/suggest.js';

const kind = z.enum(['audiobook', 'ebook']).default('audiobook');

const suggestQuery = z.object({
  q: z.string().trim().min(2, 'type at least 2 characters').max(200),
  kind,
});

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

export function searchRoutes(app: FastifyInstance, deps: SuggestDeps & { mam: MamClient }): void {
  app.get('/api/suggest', async (req, reply): Promise<SuggestResponse | void> => {
    const parsed = suggestQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    }
    return suggestBooks({ ...deps, log: req.log }, parsed.data.q, parsed.data.kind);
  });

  app.post('/api/availability', async (req, reply): Promise<AvailabilityResponse | void> => {
    const parsed = availabilityBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    }
    return checkAvailability(deps.mam, parsed.data.book, parsed.data.kind);
  });
}
