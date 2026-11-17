// Node tests for zip.js (DOM-free). Run: node test/zip.test.mjs
// Writes /tmp/stickerify-test.zip; verify independently with:
//   python3 -m zipfile -t /tmp/stickerify-test.zip
import assert from "node:assert";
import { writeFileSync } from "node:fs";
import { createZip, crc32 } from "../zip.js";

// --- crc32: known vectors ---
{
  assert.equal(crc32(new Uint8Array([])), 0, "empty crc is 0");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926, "crc32 of 123456789");
}

// --- createZip: empty archive is just the end record ---
{
  const zip = createZip([]);
  assert.equal(zip.length, 22, "empty zip is 22 bytes");
  assert.equal(zip[0], 0x50, "PK signature");
  assert.equal(zip[1], 0x4b);
}

// --- createZip: files round-trip structurally ---
{
  const files = [
    { name: "empty.txt", data: new Uint8Array([]) },
    { name: "hello.txt", data: new TextEncoder().encode("hello world") },
    { name: "bin.dat", data: Uint8Array.from({ length: 256 }, (_, i) => i) },
  ];
  const zip = createZip(files);
  writeFileSync("/tmp/stickerify-test.zip", zip);

  const view = new DataView(zip.buffer);
  // Local header of the first file.
  assert.equal(view.getUint32(0, true), 0x04034b50, "local header signature");
  assert.equal(view.getUint16(26, true), 9, "first filename length");
  assert.equal(view.getUint32(14, true), 0, "empty file crc is 0");
  // Second file's data follows its header; find "hello world".
  const text = new TextDecoder().decode(zip);
  assert.ok(text.includes("hello world"), "payload present in archive");
  assert.ok(text.includes("hello.txt"), "filename present in archive");
  // End of central directory record is the last 22 bytes; entry counts
  // sit at offsets 8 and 10 within it.
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50, "end record signature");
  assert.equal(view.getUint16(zip.length - 14, true), 3, "three central entries (disk)");
  assert.equal(view.getUint16(zip.length - 12, true), 3, "three central entries (total)");
  // Central directory offset points at a central header.
  const cdOffset = view.getUint32(zip.length - 6, true);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50, "central header at recorded offset");
}

console.log("zip.js: all tests passed");
