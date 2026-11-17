// GET /api/health: is Lectern running, and which services has it been told about?
// This never contacts MAM or anything else, so it's safe to call often
// (Docker's healthcheck calls it every 30 seconds).
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, ServiceState } from '@lectern/shared';
import type { Config } from '../config.js';

const state = (...values: Array<string | undefined>): ServiceState =>
  values.every((v) => v !== undefined) ? 'configured' : 'not-configured';

export function healthRoutes(app: FastifyInstance, config: Config, version: string): void {
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    name: 'Lectern',
    version,
    services: {
      mam: state(config.mam.cookie),
      qbittorrent: state(config.qbittorrent.url, config.qbittorrent.username, config.qbittorrent.password),
      audiobookshelf: state(config.audiobookshelf.url, config.audiobookshelf.apiKey),
    },
  }));
}
