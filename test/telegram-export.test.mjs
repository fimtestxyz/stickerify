// Node tests for the DOM-free helpers in telegram-export.js.
// Run: node test/telegram-export.test.mjs
import assert from "node:assert";
import {
  telegramSize,
  packFileName,
  TELEGRAM_LONG_SIDE,
  TELEGRAM_LIMIT_BYTES,
  TELEGRAM_MAX_STICKERS,
  PACK_ICON_SIZE,
} from "../telegram-export.js";

// --- limits ---
{
  assert.equal(TELEGRAM_LONG_SIDE, 512);
  assert.equal(TELEGRAM_LIMIT_BYTES, 512 * 1024);
  assert.equal(TELEGRAM_MAX_STICKERS, 120);
  assert.equal(PACK_ICON_SIZE, 100);
}

// --- telegramSize: long side becomes exactly 512 ---
{
  assert.deepEqual(telegramSize(800, 600), { w: 512, h: 384 }, "landscape");
  assert.deepEqual(telegramSize(400, 900), { w: 228, h: 512 }, "portrait");
  assert.deepEqual(telegramSize(512, 512), { w: 512, h: 512 }, "already 512");
  assert.deepEqual(telegramSize(100, 80), { w: 512, h: 410 }, "small image scales up");
  assert.deepEqual(telegramSize(800, 600, 100), { w: 100, h: 75 }, "pack icon long side");
}

// --- packFileName: zero-padded, numbered from 1 ---
{
  assert.equal(packFileName(0, "webp"), "sticker-01.webp");
  assert.equal(packFileName(9, "png"), "sticker-10.png");
  assert.equal(packFileName(119, "webp"), "sticker-120.webp");
}

console.log("telegram-export.js: all tests passed");
