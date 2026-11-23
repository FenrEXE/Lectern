// Profiles: who uses Lectern, whether they're an admin, and where their books go.
import type { MediaKind, Profile, ProfileCard, ProfileLibrary } from '@lectern/shared';
import type { Db } from '../db.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './passwords.js';

interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  role: 'admin' | 'member';
  color: string;
  default_kind: MediaKind;
  audiobook_dir: string | null;
  audiobook_abs_library: string | null;
  ebook_dir: string | null;
  ebook_abs_library: string | null;
  created_at: string;
}

// Avatar colours: from the brand palette, all readable with cream initials.
export const PROFILE_COLORS = ['#1F3A2E', '#3E6B52', '#7A4E2D', '#5A3E73', '#2E4F6E', '#8A3B3B', '#5B6236'];

export class UserError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const toProfile = (r: UserRow): Profile => ({
  id: r.id,
  name: r.name,
  role: r.role,
  color: r.color,
  defaultKind: r.default_kind,
  libraries: {
    audiobook: { dir: r.audiobook_dir ?? undefined, absLibraryId: r.audiobook_abs_library ?? undefined },
    ebook: { dir: r.ebook_dir ?? undefined, absLibraryId: r.ebook_abs_library ?? undefined },
  },
});

export interface NewProfile {
  name: string;
  password: string;
  role?: 'admin' | 'member';
  defaultKind?: MediaKind;
  libraries?: Partial<Record<MediaKind, ProfileLibrary>>;
}

export interface ProfileChanges {
  name?: string;
  password?: string;
  role?: 'admin' | 'member';
  color?: string;
  defaultKind?: MediaKind;
  libraries?: Partial<Record<MediaKind, ProfileLibrary>>;
}

function checkName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 1 || clean.length > 40) throw new UserError('Names need 1 to 40 characters.');
  return clean;
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > 200) throw new UserError('That password is too long.');
}

const blankToNull = (v?: string) => (v && v.trim() ? v.trim() : null);

export class UserStore {
  constructor(private readonly db: Db) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  list(): Profile[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map(toProfile);
  }

  cards(): ProfileCard[] {
    return this.list().map(({ id, name, color }) => ({ id, name, color }));
  }

  get(id: number): Profile | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row && toProfile(row);
  }

  /** The profile and its password hash, for signing in. Names ignore case. */
  forLogin(name: string): { profile: Profile; passwordHash: string } | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name.trim()) as UserRow | undefined;
    return row && { profile: toProfile(row), passwordHash: row.password_hash };
  }

  async create(input: NewProfile): Promise<Profile> {
    const name = checkName(input.name);
    checkPassword(input.password);
    if (this.forLogin(name)) throw new UserError('There’s already a profile with that name.', 409);
    const hash = await hashPassword(input.password);
    const color = PROFILE_COLORS[this.count() % PROFILE_COLORS.length]!;
    const lib = input.libraries ?? {};
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO users (name, password_hash, role, color, default_kind,
           audiobook_dir, audiobook_abs_library, ebook_dir, ebook_abs_library, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        hash,
        input.role ?? 'member',
        color,
        input.defaultKind ?? 'audiobook',
        blankToNull(lib.audiobook?.dir),
        blankToNull(lib.audiobook?.absLibraryId),
        blankToNull(lib.ebook?.dir),
        blankToNull(lib.ebook?.absLibraryId),
        new Date().toISOString(),
      );
    return this.get(Number(lastInsertRowid))!;
  }

  async update(id: number, changes: ProfileChanges): Promise<Profile> {
    const current = this.get(id);
    if (!current) throw new UserError('No such profile.', 404);
    const sets: string[] = [];
    const values: Record<string, unknown> = { id };

    if (changes.name !== undefined) {
      const name = checkName(changes.name);
      const other = this.forLogin(name);
      if (other && other.profile.id !== id) throw new UserError('There’s already a profile with that name.', 409);
      sets.push('name = @name');
      values.name = name;
    }
    if (changes.password !== undefined) {
      checkPassword(changes.password);
      sets.push('password_hash = @password_hash');
      values.password_hash = await hashPassword(changes.password);
    }
    if (changes.role !== undefined && changes.role !== current.role) {
      if (current.role === 'admin' && this.adminCount() === 1) {
        throw new UserError('Lectern needs at least one admin. Make someone else an admin first.');
      }
      sets.push('role = @role');
      values.role = changes.role;
    }
    if (changes.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(changes.color)) throw new UserError('Colours look like #3E6B52.');
      sets.push('color = @color');
      values.color = changes.color;
    }
    if (changes.defaultKind !== undefined) {
      sets.push('default_kind = @default_kind');
      values.default_kind = changes.defaultKind;
    }
    for (const kind of ['audiobook', 'ebook'] as const) {
      const lib = changes.libraries?.[kind];
      if (!lib) continue;
      if (lib.dir !== undefined) {
        sets.push(`${kind}_dir = @${kind}_dir`);
        values[`${kind}_dir`] = blankToNull(lib.dir);
      }
      if (lib.absLibraryId !== undefined) {
        sets.push(`${kind}_abs_library = @${kind}_abs_library`);
        values[`${kind}_abs_library`] = blankToNull(lib.absLibraryId);
      }
    }
    if (sets.length) this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(values);
    return this.get(id)!;
  }

  remove(id: number): void {
    const current = this.get(id);
    if (!current) throw new UserError('No such profile.', 404);
    if (current.role === 'admin' && this.adminCount() === 1) {
      throw new UserError('That’s the only admin, so it can’t be removed.');
    }
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  private adminCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
  }
}
