// GET /api/author?name=Brandon%20Sanderson&id=B001IGFHW6&kind=audiobook
// GET /api/series?name=Mistborn&author=Brandon%20Sanderson&authorId=B001IGFHW6&kind=audiobook
//
// "id"/"authorId" is Audible's author ID, when the page was opened from a book.
// Both pages only show books in the signed-in profile's language.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthorResponse, SeriesResponse } from '@lectern/shared';
import { authorBooks, seriesBooks } from '../search/browse.js';
import type { SuggestDeps } from '../search/suggest.js';

const kind = z.enum(['audiobook', 'ebook']).default('audiobook');
const audibleId = z.string().trim().regex(/^[A-Z0-9]{6,20}$/i).optional();
const authorQuery = z.object({ name: z.string().trim().min(1).max(200), id: audibleId, kind });
const seriesQuery = z.object({
  name: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).optional(),
  authorId: audibleId,
  kind,
});

export function browseRoutes(app: FastifyInstance, deps: SuggestDeps): void {
  app.get('/api/author', async (req, reply): Promise<AuthorResponse | void> => {
    const parsed = authorQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Which author?' });
    const { name, id, kind: k } = parsed.data;
    return authorBooks({ ...deps, log: req.log }, { name, id }, k, { language: req.user!.language });
  });

  app.get('/api/series', async (req, reply): Promise<SeriesResponse | void> => {
    const parsed = seriesQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Which series?' });
    const { name, author, authorId, kind: k } = parsed.data;
    const filter = author ? { name: author, id: authorId } : undefined;
    return seriesBooks({ ...deps, log: req.log }, name, filter, k, { language: req.user!.language });
  });
}
