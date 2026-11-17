// Telegram sticker-pack export (static stickers).
// Telegram's rules (checked Nov 2026): one side exactly 512 px, the other
// 512 px or less, PNG or WebP, up to 512 KB per sticker, up to 120 stickers
// per pack. Pack icon: exactly 100x100 px, up to 128 KB (optional —
// Telegram uses the first sticker otherwise). Publishing is done by the
// user in Telegram with the official @Stickers bot (/newpack); this module
// only produces the compliant files and the ZIP, all on-device.
import { createZip } from "./zip.js";

export const TELEGRAM_LONG_SIDE = 512;
export const TELEGRAM_LIMIT_BYTES = 512 * 1024;
export const TELEGRAM_MAX_STICKERS = 120;
export const PACK_ICON_SIZE = 100;
export const PACK_ICON_LIMIT_BYTES = 128 * 1024;

/** Scale (w, h) so the long side is exactly `longSide`, keeping aspect. */
export function telegramSize(w, h, longSide = TELEGRAM_LONG_SIDE) {
  const scale = longSide / Math.max(w, h);
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

export function packFileName(index, ext) {
  return `sticker-${String(index + 1).padStart(2, "0")}.${ext}`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Encode a sticker canvas to a Telegram-compliant file.
 * Tries WebP with a quality ladder, then PNG, and returns the smallest
 * result. `square` pads the output to a longSide x longSide canvas
 * (used for the 100x100 pack icon). Returns
 * { blob, ext, width, height, oversize }.
 */
export async function encodeSticker(sourceCanvas, { longSide = TELEGRAM_LONG_SIDE, limitBytes = TELEGRAM_LIMIT_BYTES, square = false } = {}) {
  const { w, h } = telegramSize(sourceCanvas.width, sourceCanvas.height, longSide);
  const canvas = document.createElement("canvas");
  canvas.width = square ? longSide : w;
  canvas.height = square ? longSide : h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);

  let best = null;
  const consider = (blob, ext) => {
    if (!blob) return;
    if (!best || blob.size < best.blob.size) best = { blob, ext };
  };
  for (const q of [0.92, 0.8, 0.65, 0.5]) {
    const blob = await canvasToBlob(canvas, "image/webp", q);
    if (blob && blob.type === "image/webp") {
      consider(blob, "webp");
      if (blob.size <= limitBytes) break; // good enough — keep quality high
    }
  }
  consider(await canvasToBlob(canvas, "image/png"), "png");
  if (!best) throw new Error("Could not encode sticker image");
  return { ...best, width: canvas.width, height: canvas.height, oversize: best.blob.size > limitBytes };
}

/**
 * Build the Telegram pack ZIP from included sticker canvases.
 * Returns { zipBlob, count, truncated, problems } where problems lists
 * any sticker that could not be squeezed under Telegram's size limit.
 */
export async function exportTelegramPack(canvases) {
  const limited = canvases.slice(0, TELEGRAM_MAX_STICKERS);
  const files = [];
  const problems = [];
  for (let i = 0; i < limited.length; i++) {
    const enc = await encodeSticker(limited[i]);
    files.push({
      name: packFileName(i, enc.ext),
      data: new Uint8Array(await enc.blob.arrayBuffer()),
    });
    if (enc.oversize) {
      problems.push(`Sticker ${i + 1} is ${(enc.blob.size / 1024).toFixed(0)} KB — over Telegram's 512 KB limit, the bot may reject it.`);
    }
  }
  const icon = await encodeSticker(limited[0], {
    longSide: PACK_ICON_SIZE,
    limitBytes: PACK_ICON_LIMIT_BYTES,
    square: true,
  });
  files.push({
    name: `pack-icon.${icon.ext}`,
    data: new Uint8Array(await icon.blob.arrayBuffer()),
  });
  const zipBlob = new Blob([createZip(files)], { type: "application/zip" });
  return {
    zipBlob,
    count: limited.length,
    truncated: canvases.length > TELEGRAM_MAX_STICKERS,
    problems,
  };
}
