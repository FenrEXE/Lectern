// GET  /api/mam/stats          the saved ratio and unsatisfied count (never asks MAM)
// POST /api/mam/stats/refresh  ask MAM now (at most every 5 minutes)
import type { FastifyInstance } from 'fastify';
import type { MamStatsResponse } from '@lectern/shared';
import type { MamStatsService } from '../mam/stats.js';

export function mamStatsRoutes(app: FastifyInstance, stats: MamStatsService): void {
  app.get('/api/mam/stats', async (): Promise<MamStatsResponse> => stats.read());
  app.post('/api/mam/stats/refresh', async (): Promise<MamStatsResponse> => stats.refresh(true));
}
