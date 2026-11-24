// Settings the admin can change from Lectern's own Settings page.
//
// Environment variables (.env) are still read first, as defaults. Anything
// saved in the admin panel is stored in Lectern's database and wins over the
// environment. Clearing a saved value falls back to the environment again.
//
// Secrets (cookies, passwords, API keys) are stored so Lectern can use them,
// but are never sent back to the browser: the panel only shows whether one is
// set and its last few characters.
//
// Two deliberate limits:
//  - MAM_REQUIRE_INTERFACE (the VPN check) can only be set in the environment.
//    It protects the MAM account, so it shouldn't be one click away.
//  - Changing where qBittorrent or Audiobookshelf lives needs its password or
//    key typed again, so a saved secret is never sent to a new address.
import { loadConfig, type Config } from './config.js';
import { deleteSetting, type Db } from './db.js';

/** Settings the admin panel can change, with the environment variable each overrides. */
export const EDITABLE_SETTINGS = [
  'MAM_ID',
  'QB_URL',
  'QB_USER',
  'QB_PASS',
  'QB_API_KEY',
  'QB_CATEGORY',
  'QB_SAVE_PATH',
  'QB_PATH_FROM',
  'QB_PATH_TO',
  'ABS_URL',
  'ABS_API_KEY',
  'GOOGLE_BOOKS_API_KEY',
  'AUDIBLE_REGION',
] as const;

export type SettingKey = (typeof EDITABLE_SETTINGS)[number];

export const SECRET_SETTINGS: ReadonlySet<SettingKey> = new Set(['MAM_ID', 'QB_PASS', 'QB_API_KEY', 'ABS_API_KEY', 'GOOGLE_BOOKS_API_KEY']);

/** Lectern-only options that have no environment variable. */
export interface AppOptions {
  /** Show profile names on the sign-in page (otherwise people type their name). */
  showProfiles: boolean;
}

/** How one setting looks to the admin panel. */
export interface SettingView {
  key: SettingKey;
  /** The current value. Always null for secrets. */
  value: string | null;
  secret: boolean;
  isSet: boolean;
  /** For secrets: the last few characters, so you can tell which one it is. */
  hint?: string;
  /** Where the current value comes from. */
  source: 'saved' | 'environment' | 'default';
}

export class SettingsError extends Error {}

/** An address, and the secrets that get sent to it. */
const ADDRESS_SECRETS = [
  {
    address: 'QB_URL',
    service: 'qBittorrent',
    secrets: [
      { key: 'QB_PASS', what: 'password' },
      { key: 'QB_API_KEY', what: 'API key' },
    ],
  },
  { address: 'ABS_URL', service: 'Audiobookshelf', secrets: [{ key: 'ABS_API_KEY', what: 'API key' }] },
] as const;

const PREFIX = 'setting.';

export class Settings {
  private cached?: Config;

  constructor(
    private readonly db: Db,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  /** The settings in force right now: saved values over the environment. */
  config = (): Config => {
    this.cached ??= loadConfig({ ...this.env, ...this.saved() });
    return this.cached;
  };

  /** Values saved from the admin panel. */
  saved(): Partial<Record<SettingKey, string>> {
    const rows = this.db.prepare("SELECT key, value FROM kv WHERE key LIKE 'setting.%'").all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Partial<Record<SettingKey, string>> = {};
    for (const { key, value } of rows) {
      const name = key.slice(PREFIX.length) as SettingKey;
      if ((EDITABLE_SETTINGS as readonly string[]).includes(name)) out[name] = value;
    }
    return out;
  }

  /**
   * Save changes. A string saves that value (even blank, which turns the
   * setting off); null removes the saved value so the environment applies.
   * Everything is checked first: one bad value means nothing is saved.
   */
  update(changes: Partial<Record<SettingKey, string | null>>): void {
    const unknown = Object.keys(changes).filter((k) => !(EDITABLE_SETTINGS as readonly string[]).includes(k));
    if (unknown.length) throw new SettingsError(`Unknown setting: ${unknown.join(', ')}`);

    const before: Record<string, string | undefined> = { ...this.saved() };
    const next: Record<string, string | undefined> = { ...before };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value.trim();
    }

    // A new address (typed in, not reset to the environment's) must come with
    // its secret typed in too, unless there's no secret to send.
    const current = (values: Record<string, string | undefined>, key: string) =>
      (values[key] ?? this.env[key] ?? '').trim().replace(/\/+$/, '');
    for (const pair of ADDRESS_SECRETS) {
      const address = changes[pair.address];
      if (typeof address !== 'string' || current(next, pair.address) === current(before, pair.address)) continue;
      for (const secret of pair.secrets) {
        const typed = changes[secret.key];
        if (current(next, secret.key) && !(typeof typed === 'string' && typed.trim())) {
          throw new SettingsError(
            `To change ${pair.service}’s address, type its ${secret.what} again too (or clear it). That way a saved ${secret.what} is never sent to a new address by mistake.`,
          );
        }
      }
    }
    try {
      loadConfig({ ...this.env, ...next });
    } catch (err) {
      throw new SettingsError((err as Error).message.replace("Lectern's settings have problems:", 'Not saved:'));
    }

    this.db.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) deleteSetting(this.db, PREFIX + key);
        else if (value !== undefined) {
          this.db
            .prepare(
              `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .run(PREFIX + key, value.trim(), Date.now());
        }
      }
    })();
    this.cached = undefined;
  }

  /** Every editable setting, safe to show in the admin panel. */
  describe(): SettingView[] {
    const saved = this.saved();
    return EDITABLE_SETTINGS.map((key) => {
      const secret = SECRET_SETTINGS.has(key);
      const fromSaved = saved[key];
      const fromEnv = this.env[key]?.trim() || undefined;
      const raw = fromSaved !== undefined ? fromSaved : fromEnv;
      const source = fromSaved !== undefined ? 'saved' : fromEnv !== undefined ? 'environment' : 'default';
      const isSet = !!raw;
      return {
        key,
        secret,
        isSet,
        value: secret ? null : (raw ?? null),
        hint: secret && raw && raw.length >= 8 ? `…${raw.slice(-4)}` : undefined,
        source,
      };
    });
  }

  options(): AppOptions {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = 'option.showProfiles'").get() as
      | { value: string }
      | undefined;
    return { showProfiles: row ? row.value === 'true' : true };
  }

  setOptions(options: Partial<AppOptions>): void {
    if (options.showProfiles !== undefined) {
      this.db
        .prepare(
          `INSERT INTO kv (key, value, updated_at) VALUES ('option.showProfiles', ?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(String(options.showProfiles), Date.now());
    }
  }
}
