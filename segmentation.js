// Pure, DOM-free helpers for head segmentation masks.
// A mask is a Uint8Array of 0/1 values, row-major, width * height entries.

/**
 * Label the connected components of a binary mask (4-connectivity) and
 * return the components sorted by pixel count, largest first.
 * Each component: { id, pixels, minX, minY, maxX, maxY, count }.
 * Components smaller than minPixels are dropped (noise).
 */
export function labelComponents(mask, width, height, minPixels = 40) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const queue = new Int32Array(width * height);
  const dirs = [1, -1, width, -width];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = components.length;
    let qHead = 0, qTail = 0;
    queue[qTail++] = start;
    labels[start] = id;
    let count = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    while (qHead < qTail) {
      const p = queue[qHead++];
      count++;
      const x = p % width, y = (p / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const d of dirs) {
        const n = p + d;
        // Guard against wrapping across row edges for left/right steps.
        if (d === 1 && x === width - 1) continue;
        if (d === -1 && x === 0) continue;
        if (n < 0 || n >= mask.length) continue;
        if (mask[n] && labels[n] === -1) {
          labels[n] = id;
          queue[qTail++] = n;
        }
      }
    }
    if (count >= minPixels) {
      components.push({ id, minX, minY, maxX, maxY, count });
    }
  }
  // Re-map labels so dropped (tiny) components have label -1 in the output.
  const keep = new Map();
  components.forEach((c, i) => keep.set(c.id, i));
  const outLabels = new Int32Array(width * height);
  for (let i = 0; i < labels.length; i++) {
    outLabels[i] = labels[i] === -1 ? -1 : (keep.get(labels[i]) ?? -1);
  }
  components.sort((a, b) => b.count - a.count);
  return { labels: outLabels, components };
}

/**
 * Dilate a binary mask by `radius` pixels (square structuring element,
 * repeated 3x3 passes). Returns a new Uint8Array.
 */
export function dilateMask(mask, width, height, radius) {
  let cur = mask;
  for (let r = 0; r < radius; r++) {
    const next = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (cur[ny * width + nx]) { v = 1; break; }
          }
        }
        next[y * width + x] = v;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Nearest-neighbour upscale of a category mask (values 0..255) to a new size.
 * Used to bring a 256x256 model mask back up to photo resolution without
 * blending category indices together.
 */
export function upscaleNearest(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, (y * srcH / dstH) | 0);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, (x * srcW / dstW) | 0);
      dst[y * dstW + x] = src[sy * srcW + sx];
    }
  }
  return dst;
}

/** Multiclass selfie-segmentation category indices (MediaPipe model card). */
export const CATEGORY = {
  BACKGROUND: 0,
  HAIR: 1,
  BODY_SKIN: 2,
  FACE_SKIN: 3,
  CLOTHES: 4,
  OTHER: 5,
};

/** Head pixels in a multiclass category mask: hair + face skin. */
export function headMaskFromCategories(catMask) {
  const out = new Uint8Array(catMask.length);
  for (let i = 0; i < catMask.length; i++) {
    const c = catMask[i];
    out[i] = (c === CATEGORY.HAIR || c === CATEGORY.FACE_SKIN) ? 1 : 0;
  }
  return out;
}
