// GET /api/health: is Lectern running, and which services has it been told about?
// This never contacts MAM or anything else, so it's safe to call often
// (Docker's healthcheck calls it every 30 seconds).
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, ServiceState } from '@lectern/shared';
import type { Config } from '../config.js';
import type { MamClient } from '../mam/client.js';
import type { RequestService } from '../requests/service.js';

const state = (...values: Array<string | undefined>): ServiceState =>
  values.every((v) => v !== undefined) ? 'configured' : 'not-configured';

export function healthRoutes(
  app: FastifyInstance,
  config: Config,
  mam: MamClient,
  requests: RequestService,
  version: string,
): void {
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    name: 'Lectern',
    version,
    services: {
      mam: mam.isConfigured() ? 'configured' : 'not-configured',
      // A username and password are optional: qBittorrent can skip logins for local addresses.
      qbittorrent: state(config.qbittorrent.url),
      audiobookshelf: state(config.audiobookshelf.url, config.audiobookshelf.apiKey),
    },
    canAdd: { audiobook: requests.canAdd('audiobook'), ebook: requests.canAdd('ebook') },
  }));
}
