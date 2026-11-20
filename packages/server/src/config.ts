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
  QB_CATEGORY: z.string().trim().default('lectern'),
  QB_SAVE_PATH: optional,
  QB_PATH_FROM: optional,
  QB_PATH_TO: optional,
  LIBRARY_AUDIOBOOKS_DIR: optional,
  LIBRARY_EBOOKS_DIR: optional,
  ABS_URL: optionalUrl,
  ABS_API_KEY: optional,
  ABS_AUDIOBOOKS_LIBRARY_ID: optional,
  ABS_EBOOKS_LIBRARY_ID: optional,
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
  qbittorrent: {
    url?: string;
    username?: string;
    password?: string;
    /** Category Lectern's downloads go in. */
    category: string;
    /** Where qBittorrent should save them (as qBittorrent sees it). */
    savePath?: string;
    /**
     * When qBittorrent and Lectern see the same files under different paths,
     * replace `pathFrom` (qBittorrent's view) with `pathTo` (Lectern's).
     */
    pathFrom?: string;
    pathTo?: string;
  };
  /** The folders books are filed into, per kind. Unset = "Add" is off for that kind. */
  libraries: { audiobook?: string; ebook?: string };
  audiobookshelf: { url?: string; apiKey?: string; libraryIds: { audiobook?: string; ebook?: string } };
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
    qbittorrent: {
      url: trimSlash(e.QB_URL),
      username: e.QB_USER,
      password: e.QB_PASS,
      category: e.QB_CATEGORY || 'lectern',
      savePath: e.QB_SAVE_PATH,
      pathFrom: e.QB_PATH_FROM,
      pathTo: e.QB_PATH_TO,
    },
    libraries: { audiobook: e.LIBRARY_AUDIOBOOKS_DIR, ebook: e.LIBRARY_EBOOKS_DIR },
    audiobookshelf: {
      url: trimSlash(e.ABS_URL),
      apiKey: e.ABS_API_KEY,
      libraryIds: { audiobook: e.ABS_AUDIOBOOKS_LIBRARY_ID, ebook: e.ABS_EBOOKS_LIBRARY_ID },
    },
    audibleRegion: e.AUDIBLE_REGION,
    googleBooksApiKey: e.GOOGLE_BOOKS_API_KEY,
  };
}
