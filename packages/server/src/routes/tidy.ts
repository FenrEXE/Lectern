// Tidy up (admin only; /api/admin/* is admin-guarded):
// GET  /api/admin/tidy                     the newest run and its books
// POST /api/admin/tidy/scan {libraryId}    start a scan (changes nothing)
// POST /api/admin/tidy/:id/apply {items}   fix the picked books (tidy_items ids)
// POST /api/admin/tidy/:id/undo {items?}   put the fixed books back (all of them, or just these)
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TidyRun, TidyRunResponse } from '@lectern/shared';
import { TidyError, type TidyService } from '../tidy/service.js';

const scanBody = z.object({ libraryId: z.string().min(1).max(100) });
const applyBody = z.object({ items: z.array(z.number().int().positive()).min(1).max(10_000) });
const runParams = z.object({ id: z.coerce.number().int().positive() });

const fail = (reply: FastifyReply, err: unknown) => {
  if (err instanceof TidyError) return reply.code(409).send({ error: err.message });
  return reply.code(502).send({ error: (err as Error).message });
};

export function tidyRoutes(app: FastifyInstance, tidy: TidyService): void {
  app.get('/api/admin/tidy', async (): Promise<TidyRunResponse> => tidy.latest());

  app.post('/api/admin/tidy/scan', async (req, reply): Promise<TidyRun | void> => {
    const parsed = scanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Pick a library.' });
    try {
      return await tidy.startScan(parsed.data.libraryId, { language: req.user!.language });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/tidy/:id/apply', async (req, reply): Promise<TidyRun | void> => {
    const params = runParams.safeParse(req.params);
    const body = applyBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Pick at least one book to fix.' });
    try {
      return tidy.startApply(params.data.id, body.data.items);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/admin/tidy/:id/undo', async (req, reply): Promise<TidyRun | void> => {
    const params = runParams.safeParse(req.params);
    const body = z.object({ items: z.array(z.number().int().positive()).max(10_000).optional() }).safeParse(req.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Which run?' });
    try {
      return tidy.startUndo(params.data.id, body.data.items);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
