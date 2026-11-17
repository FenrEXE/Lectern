// Reads Lectern's settings from environment variables, once, at startup.
// Every setting is listed in .env.example at the repo root.
import path from 'node:path';
import { z } from 'zod';

// Blank values count as "not set", so a copied .env.example works as-is.
const optional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const optionalUrl = optional.refine(
  (v) => v === undefined || /^https?:\/\//.test(v),
  'must start with http:// or https://',
);

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MAM_ID: optional,
  MAM_REQUIRE_INTERFACE: optional,
  QB_URL: optionalUrl,
  QB_USER: optional,
  QB_PASS: optional,
  ABS_URL: optionalUrl,
  ABS_API_KEY: optional,
  AUDIBLE_REGION: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || 'us')
    .pipe(z.enum(['us', 'uk', 'ca', 'au', 'de', 'fr', 'it', 'es', 'in', 'jp']))
    .default('us'),
  GOOGLE_BOOKS_API_KEY: optional,
});

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  mam: {
    cookie?: string;
    /** A network interface (e.g. "wg0") that must exist before Lectern talks to MAM. */
    requireInterface?: string;
  };
  qbittorrent: { url?: string; username?: string; password?: string };
  audiobookshelf: { url?: string; apiKey?: string };
  audibleRegion: string;
  googleBooksApiKey?: string;
}

/** Parse and check settings. Throws a readable error listing every bad value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Lectern's settings have problems:\n${problems}`);
  }
  const e = parsed.data;
  const trimSlash = (u?: string) => u?.replace(/\/+$/, '');
  // People often paste the whole "mam_id=..." cookie; keep just the value.
  const mamCookie = e.MAM_ID?.replace(/^mam_id=/, '').replace(/;.*$/, '');
  return {
    port: e.PORT,
    host: e.HOST,
    dataDir: path.resolve(e.DATA_DIR),
    logLevel: e.LOG_LEVEL,
    mam: { cookie: mamCookie || undefined, requireInterface: e.MAM_REQUIRE_INTERFACE },
    qbittorrent: { url: trimSlash(e.QB_URL), username: e.QB_USER, password: e.QB_PASS },
    audiobookshelf: { url: trimSlash(e.ABS_URL), apiKey: e.ABS_API_KEY },
    audibleRegion: e.AUDIBLE_REGION,
    googleBooksApiKey: e.GOOGLE_BOOKS_API_KEY,
  };
}
