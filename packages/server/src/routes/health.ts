// GET /api/health  public, for Docker's health check: is Lectern running?
// GET /api/status  signed in: which services are set up, and can this profile add books?
// Neither contacts MAM or anything else, so they're safe to call often.
import type { FastifyInstance } from 'fastify';
import type { HealthResponse, ServiceState, StatusResponse } from '@lectern/shared';
import { readConfig, type ConfigSource } from '../config.js';
import type { MamClient } from '../mam/client.js';
import type { RequestService } from '../requests/service.js';

const state = (...values: Array<string | undefined>): ServiceState =>
  values.every((v) => v !== undefined) ? 'configured' : 'not-configured';

export function healthRoutes(
  app: FastifyInstance,
  configSource: ConfigSource,
  mam: MamClient,
  requests: RequestService,
  version: string,
): void {
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok', name: 'Lectern', version }));

  app.get('/api/status', async (req): Promise<StatusResponse> => {
    const config = readConfig(configSource);
    return {
      version,
      services: {
        mam: mam.isConfigured() ? 'configured' : 'not-configured',
        // A username and password are optional: qBittorrent can skip logins for local addresses.
        qbittorrent: state(config.qbittorrent.url),
        audiobookshelf: state(config.audiobookshelf.url, config.audiobookshelf.apiKey),
      },
      canAdd: { audiobook: requests.canAdd('audiobook', req.user), ebook: requests.canAdd('ebook', req.user) },
    };
  });
}
