// Minimal dependency-free ZIP writer (STORE method, no compression).
// Keeps the app fully self-contained — no CDN library needed at export time,
// which matters for a tool whose pitch is "nothing leaves your device".
// A zip is: local file headers + data, then a central directory, then the
// end-of-central-directory record. All integers are little-endian.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 25)
    | (((date.getMonth() + 1) & 0xf) << 21)
    | ((date.getDate() & 0x1f) << 16);
  return { time, date: day };
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value, true); }

/**
 * Build a ZIP archive from files: [{ name, data: Uint8Array }].
 * Names must be ASCII (or UTF-8; the flag is set so readers decode them
 * as UTF-8). Returns a Uint8Array of the whole archive.
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x04034b50); // local file header signature
    u16(view, 4, 20);         // version needed to extract
    u16(view, 6, 0x0800);     // flags: UTF-8 filenames
    u16(view, 8, 0);          // method: STORE
    u16(view, 10, time);
    u16(view, 12, date);
    u32(view, 14, crc);
    u32(view, 18, file.data.length);
    u32(view, 22, file.data.length);
    u16(view, 26, nameBytes.length);
    u16(view, 28, 0); // extra field length
    chunks.push(header, nameBytes, file.data);
    central.push({ nameBytes, crc, size: file.data.length, offset, time, date });
    offset += header.length + nameBytes.length + file.data.length;
  }

  const cdStart = offset;
  for (const entry of central) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x02014b50); // central directory signature
    u16(view, 4, 20);         // version made by
    u16(view, 6, 20);         // version needed to extract
    u16(view, 8, 0x0800);     // flags: UTF-8 filenames
    u16(view, 10, 0);         // method: STORE
    u16(view, 12, entry.time);
    u16(view, 14, entry.date);
    u32(view, 16, entry.crc);
    u32(view, 20, entry.size);
    u32(view, 24, entry.size);
    u16(view, 28, entry.nameBytes.length);
    u16(view, 30, 0); // extra field length
    u16(view, 32, 0); // comment length
    u16(view, 34, 0); // disk number start
    u16(view, 36, 0); // internal attributes
    u32(view, 38, 0); // external attributes
    u32(view, 42, entry.offset);
    chunks.push(header, entry.nameBytes);
    offset += header.length + entry.nameBytes.length;
  }

  const cdSize = offset - cdStart;
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50); // end of central directory signature
  u16(view, 4, 0);          // disk number
  u16(view, 6, 0);          // central directory disk
  u16(view, 8, central.length);
  u16(view, 10, central.length);
  u32(view, 12, cdSize);
  u32(view, 16, cdStart);
  u16(view, 20, 0); // comment length
  chunks.push(end);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
