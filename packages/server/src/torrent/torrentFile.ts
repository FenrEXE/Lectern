// Just enough of the .torrent format to check a file is real and get its
// info hash: the ID qBittorrent uses for it, so Lectern can follow its progress.
//
// .torrent files use "bencode": i42e is a number, 4:spam is a string,
// l...e is a list and d...e is a dictionary. The info hash is the SHA-1 of the
// exact bytes of the "info" dictionary, so we track where it starts and ends.
import { createHash } from 'node:crypto';

export class TorrentFileError extends Error {}

interface Cursor {
  buf: Buffer;
  pos: number;
}

const byte = (c: Cursor) => {
  if (c.pos >= c.buf.length) throw new TorrentFileError('The file ends too early.');
  return c.buf[c.pos]!;
};

/** Skip one value, returning the bytes of the "info" value if we pass it at the top level. */
function skipValue(c: Cursor, depth: number, captureInfo?: { start: number; end: number }): void {
  if (depth > 64) throw new TorrentFileError('Nested too deeply to be a real torrent.');
  const b = byte(c);
  if (b === 0x69 /* i */) {
    const end = c.buf.indexOf(0x65 /* e */, c.pos);
    if (end === -1) throw new TorrentFileError('Unfinished number.');
    c.pos = end + 1;
  } else if (b === 0x6c /* l */) {
    c.pos++;
    while (byte(c) !== 0x65) skipValue(c, depth + 1);
    c.pos++;
  } else if (b === 0x64 /* d */) {
    c.pos++;
    while (byte(c) !== 0x65) {
      const key = readString(c).toString('latin1');
      const start = c.pos;
      skipValue(c, depth + 1);
      if (captureInfo && depth === 0 && key === 'info') {
        captureInfo.start = start;
        captureInfo.end = c.pos;
      }
    }
    c.pos++;
  } else if (b >= 0x30 && b <= 0x39) {
    readString(c);
  } else {
    throw new TorrentFileError('Not a torrent file.');
  }
}

function readString(c: Cursor): Buffer {
  const colon = c.buf.indexOf(0x3a /* : */, c.pos);
  if (colon === -1) throw new TorrentFileError('Broken text field.');
  const length = Number(c.buf.toString('latin1', c.pos, colon));
  if (!Number.isInteger(length) || length < 0) throw new TorrentFileError('Broken text field.');
  const start = colon + 1;
  if (start + length > c.buf.length) throw new TorrentFileError('The file ends too early.');
  c.pos = start + length;
  return c.buf.subarray(start, start + length);
}

/** Check the bytes really are a .torrent file, and return its info hash (lower-case hex). */
export function torrentInfoHash(data: Buffer): string {
  if (data.length === 0 || data[0] !== 0x64 /* d */) {
    throw new TorrentFileError('Not a torrent file.');
  }
  const cursor = { buf: data, pos: 0 };
  const info = { start: -1, end: -1 };
  skipValue(cursor, 0, info);
  if (info.start === -1) throw new TorrentFileError('The torrent has no "info" section.');
  return createHash('sha1').update(data.subarray(info.start, info.end)).digest('hex');
}
