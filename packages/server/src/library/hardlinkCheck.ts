// "Will books be hardlinked into this library, or copied?" Checked for real:
// a tiny file is made in the downloads folder, linked into the library folder,
// and both are removed again.
//
// Hardlinks need the downloads and the library on the same drive AND, inside
// Docker, reached through the same mount. Two separate mounts (-v /a:/downloads
// -v /b:/audiobooks) look like different drives to Lectern even when they
// aren't, so books get copied and use double the space.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface HardlinkCheck {
  /** linked: all good. copy: books will be copied. unknown: couldn't tell. */
  result: 'linked' | 'copy' | 'unknown';
  message: string;
}

export async function checkHardlink(downloadDir: string | undefined, libraryDir: string): Promise<HardlinkCheck> {
  if (!downloadDir) {
    return {
      result: 'unknown',
      message: 'Set “Save downloads to” under Connections → qBittorrent, so Lectern can check that books will be hardlinked.',
    };
  }
  const name = `.lectern-link-test-${randomBytes(4).toString('hex')}`;
  const source = path.join(downloadDir, name);
  const target = path.join(libraryDir, name);
  try {
    await fs.writeFile(source, 'lectern');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      result: 'unknown',
      message:
        code === 'ENOENT'
          ? `Lectern can’t see the downloads folder ${downloadDir}. Mount it into Lectern at the same path qBittorrent uses (or set the path translation under Connections).`
          : `Lectern can’t write in the downloads folder ${downloadDir} (${code}). Check PUID/PGID.`,
    };
  }
  try {
    await fs.link(source, target);
    const [a, b] = await Promise.all([fs.stat(source), fs.stat(target)]);
    return a.ino === b.ino
      ? { result: 'linked', message: 'Books will be hardlinked: no extra space, and seeding keeps working.' }
      : { result: 'copy', message: 'Linking didn’t work as expected, so books will be copied (double the space).' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      return {
        result: 'copy',
        message:
          'Books will be copied, not hardlinked, so each one uses double the space. Lectern sees the downloads and this library as different drives: put both on one drive and mount one shared parent folder into Lectern (for example -v /mnt/media:/media), not two separate folders.',
      };
    }
    return { result: 'copy', message: `Books will be copied, not hardlinked (${code ?? (err as Error).message}).` };
  } finally {
    await fs.rm(target, { force: true }).catch(() => undefined);
    await fs.rm(source, { force: true }).catch(() => undefined);
  }
}
