import { deflateRawSync } from "node:zlib";

/**
 * Minimal ZIP writer using only Node built-ins (`node:zlib`). Produces a valid
 * ZIP archive (local file headers + central directory) so `orbit extension
 * package` can emit a genuinely distributable artifact without third-party deps.
 *
 * Supports the common case: regular files, deflate compression, no ZIP64. CRC32
 * is computed per entry as the spec requires.
 */

/** One file to place in the archive. */
export interface ZipEntry {
  /** Forward-slash path inside the archive. */
  readonly path: string;
  readonly data: Buffer;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i] ?? 0;
    const index = (crc ^ byte) & 0xff;
    crc = (CRC_TABLE[index] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp for reproducible archives (1980-01-01 00:00:00).
const DOS_TIME = 0;
const DOS_DATE = 0b0000000_0001_00001; // year 1980 (0), month 1, day 1

/** Builds a ZIP archive Buffer from the given entries. */
export function createZip(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);
    const useDeflate = compressed.length < entry.data.length;
    const stored = useDeflate ? compressed : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central dir start disk
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralDir.length, 12); // central dir size
  end.writeUInt32LE(localData.length, 16); // central dir offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localData, centralDir, end]);
}
