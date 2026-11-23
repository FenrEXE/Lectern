// GET /api/author?name=Brandon%20Sanderson&kind=audiobook
// GET /api/series?name=Mistborn&author=Brandon%20Sanderson&kind=audiobook
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthorResponse, SeriesResponse } from '@lectern/shared';
import { authorBooks, seriesBooks } from '../search/browse.js';
import type { SuggestDeps } from '../search/suggest.js';

const kind = z.enum(['audiobook', 'ebook']).default('audiobook');
const authorQuery = z.object({ name: z.string().trim().min(1).max(200), kind });
const seriesQuery = z.object({
  name: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).optional(),
  kind,
});

export function browseRoutes(app: FastifyInstance, deps: SuggestDeps): void {
  app.get('/api/author', async (req, reply): Promise<AuthorResponse | void> => {
    const parsed = authorQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Which author?' });
    return authorBooks({ ...deps, log: req.log }, parsed.data.name, parsed.data.kind);
  });

  app.get('/api/series', async (req, reply): Promise<SeriesResponse | void> => {
    const parsed = seriesQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Which series?' });
    const { name, author, kind: k } = parsed.data;
    return seriesBooks({ ...deps, log: req.log }, name, author || undefined, k);
  });
}
