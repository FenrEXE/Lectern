// GET  /api/requests            your latest "Add to Library" requests (?all=1: everyone's, admins only)
// POST /api/requests            add a book: { kind, book, torrent: { id, title } }
// POST /api/requests/:id/retry  try a failed one again
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LibraryRequest } from '@lectern/shared';
import { isAllowedCover } from '../coverFetch.js';
import { RequestError, type RequestService } from '../requests/service.js';

const series = z.object({ name: z.string().min(1).max(300), number: z.string().max(20).optional() });
const createBody = z.object({
  kind: z.enum(['audiobook', 'ebook']),
  torrent: z.object({ id: z.string().regex(/^\d+$/), title: z.string().min(1).max(500) }),
  book: z.object({
    title: z.string().trim().min(1).max(500),
    subtitle: z.string().max(500).optional(),
    authors: z.array(z.string().max(200)).max(10).default([]),
    narrators: z.array(z.string().max(200)).max(20).optional(),
    series: z.array(series).max(5).optional(),
    description: z.string().max(20_000).optional(),
    asin: z.string().max(20).optional(),
    isbn: z.string().max(20).optional(),
    publishedYear: z.number().int().optional(),
    durationMinutes: z.number().optional(),
    // A cover from anywhere else is dropped (the book is still added).
    coverUrl: z
      .string()
      .max(2000)
      .optional()
      .transform((u) => (u && isAllowedCover(u) ? u : undefined)),
  }),
});

export function requestRoutes(app: FastifyInstance, requests: RequestService): void {
  app.get<{ Querystring: { all?: string } }>('/api/requests', async (req): Promise<LibraryRequest[]> => {
    const everyone = req.query.all === '1' && req.user!.role === 'admin';
    return requests.list(everyone ? undefined : req.user!.id);
  });

  app.post('/api/requests', async (req, reply): Promise<LibraryRequest | void> => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad request' });
    const { kind, book, torrent } = parsed.data;
    try {
      return await requests.create({ kind, book, torrentId: torrent.id, torrentTitle: torrent.title, userId: req.user!.id });
    } catch (err) {
      if (err instanceof RequestError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/api/requests/:id/retry', async (req, reply): Promise<LibraryRequest | void> => {
    const existing = requests.get(Number(req.params.id));
    // Only the person who asked (or an admin) can retry.
    if (!existing || (existing.userId !== req.user!.id && req.user!.role !== 'admin')) {
      return reply.code(404).send({ error: 'No such request.' });
    }
    try {
      return requests.retry(existing.id);
    } catch (err) {
      if (err instanceof RequestError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
