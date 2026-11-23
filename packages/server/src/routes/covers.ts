// GET /api/cover?u=<cover address>&w=300
//
// Fast covers: each one is fetched once, shrunk to a small WebP and kept on
// disk, then served from there with a year-long browser cache. Lists load a
// few dozen KB instead of megabytes, and repeat visits are instant.
//
// Only covers from known book-cover sites are fetched, so this can't be used
// to make Lectern fetch arbitrary addresses.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { fetchCover, isAllowedCover } from '../coverFetch.js';
import type { FetchFn } from '../http.js';

const WIDTHS = [120, 300, 600] as const;
const MAX_DOWNLOAD = 15 * 1024 * 1024;

export function coverRoutes(app: FastifyInstance, deps: { dataDir: string; fetch: FetchFn }): void {
  const dir = path.join(deps.dataDir, 'covers');
  // Two people opening the same page at once shouldn't fetch each cover twice.
  const inFlight = new Map<string, Promise<Buffer>>();

  async function make(url: string, width: number, file: string): Promise<Buffer> {
    const original = (await fetchCover(deps.fetch, url, MAX_DOWNLOAD)).data;
    const webp = await sharp(original).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, webp);
    return webp;
  }

  app.get<{ Querystring: { u?: string; w?: string } }>('/api/cover', async (req, reply) => {
    const url = req.query.u ?? '';
    const asked = Number(req.query.w) || 300;
    const width = WIDTHS.find((w) => w >= asked) ?? WIDTHS[WIDTHS.length - 1]!;
    if (!isAllowedCover(url)) return reply.code(400).send({ error: 'Not a cover Lectern can fetch.' });

    const name = createHash('sha1').update(`${width}|${url}`).digest('hex');
    const file = path.join(dir, `${name}.webp`);
    let image: Buffer | undefined = await fs.readFile(file).catch(() => undefined);
    if (!image) {
      let job = inFlight.get(name);
      if (!job) {
        job = make(url, width, file).finally(() => inFlight.delete(name));
        inFlight.set(name, job);
      }
      try {
        image = await job;
      } catch (err) {
        req.log.debug({ err: String(err) }, 'Cover unavailable');
        return reply.code(502).send({ error: 'Cover unavailable.' });
      }
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(image);
  });
}
