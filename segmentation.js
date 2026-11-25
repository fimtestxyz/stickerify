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

/** Body pixels in a multiclass category mask: body skin + clothes. */
export function bodyMaskFromCategories(catMask) {
  const out = new Uint8Array(catMask.length);
  for (let i = 0; i < catMask.length; i++) {
    const c = catMask[i];
    out[i] = (c === CATEGORY.BODY_SKIN || c === CATEGORY.CLOTHES) ? 1 : 0;
  }
  return out;
}

function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.max(dx, dy);
}

/**
 * Group head and body blobs into whole people for full-body stickers.
 * Each head starts a person; nearby body blobs (torso, arms, legs) are
 * merged into the closest person, growing its bounding box as parts are
 * added, so a leg attaches through the torso even when it is far from the
 * head itself. Body blobs too far from every person become their own
 * sticker (head out of frame). Returns [{ bbox, mask }] sorted by pixel
 * count, largest first. `mask` is a Uint8Array of 0/1 over width*height.
 */
export function groupFullBody(headMask, bodyMask, width, height, minPixels = 40) {
  const heads = labelComponents(headMask, width, height, minPixels);
  const bodies = labelComponents(bodyMask, width, height, minPixels);
  const gapLimit = Math.round(Math.max(width, height) * 0.15);

  const persons = heads.components.map((c) => ({
    bbox: { minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY },
    ids: new Set([`h${c.id}`]),
    count: c.count,
  }));
  // Head labels are re-mapped 0..n-1 by labelComponents; prefix them so
  // they never collide with body labels.
  const headLabels = heads.labels;
  const bodyLabels = bodies.labels;

  // Greedy: attach the closest remaining body blob to any person, while
  // it is within the gap limit; each merge grows the person's bbox.
  const remaining = [...bodies.components];
  for (;;) {
    let best = null;
    for (const b of remaining) {
      for (const person of persons) {
        const gap = bboxGap(b, person.bbox);
        if (!best || gap < best.gap) best = { body: b, person, gap };
      }
    }
    if (!best || best.gap > gapLimit) break;
    const { body, person } = best;
    person.ids.add(body.id);
    person.count += body.count;
    person.bbox.minX = Math.min(person.bbox.minX, body.minX);
    person.bbox.minY = Math.min(person.bbox.minY, body.minY);
    person.bbox.maxX = Math.max(person.bbox.maxX, body.maxX);
    person.bbox.maxY = Math.max(person.bbox.maxY, body.maxY);
    remaining.splice(remaining.indexOf(body), 1);
  }
  // Unattached body blobs become headless people of their own.
  for (const b of remaining) {
    persons.push({
      bbox: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
      ids: new Set([b.id]),
      count: b.count,
      headless: true,
    });
  }

  return persons
    .sort((a, b) => b.count - a.count)
    .map((person) => {
      const m = new Uint8Array(width * height);
      for (let p = 0; p < width * height; p++) {
        if (headLabels[p] !== -1 && person.ids.has(`h${headLabels[p]}`)) m[p] = 1;
        else if (bodyLabels[p] !== -1 && person.ids.has(bodyLabels[p])) m[p] = 1;
      }
      return { bbox: person.bbox, mask: m };
    });
}

/** DeepLabV3 (PASCAL VOC) category names, index = category id. */
export const DEEPLAB_CATEGORIES = [
  "background", "aeroplane", "bicycle", "bird", "boat", "bottle", "bus",
  "car", "cat", "chair", "cow", "dining table", "dog", "horse", "motorbike",
  "person", "potted plant", "sheep", "sofa", "train", "tv",
];

/**
 * Split a DeepLab category mask into individual objects: connected
 * components where two pixels join only when they share a category and
 * touch (4-connectivity). Returns { labels, objects } — labels is an
 * Int32Array of per-pixel object ids (-1 = background or dropped), and
 * objects is [{ id, category, count, bbox }] in first-seen (scan) order,
 * so labels[p] === objects[i].id always holds. Sort a copy for display;
 * never reorder this array in place. Components smaller than minPixels
 * are dropped (noise) and their labels reset to -1.
 */
export function objectsFromCategories(catMask, width, height, minPixels = 100) {
  const labels = new Int32Array(width * height).fill(-1);
  const objects = [];
  const queue = new Int32Array(width * height);
  const dirs = [1, -1, width, -width];

  for (let start = 0; start < catMask.length; start++) {
    const cat = catMask[start];
    if (!cat || labels[start] !== -1) continue;
    const id = objects.length;
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
        if (d === 1 && x === width - 1) continue;
        if (d === -1 && x === 0) continue;
        if (n < 0 || n >= catMask.length) continue;
        if (catMask[n] === cat && labels[n] === -1) {
          labels[n] = id;
          queue[qTail++] = n;
        }
      }
    }
    if (count >= minPixels) {
      objects.push({ id, category: cat, count, bbox: { minX, minY, maxX, maxY } });
    } else {
      // Dropped as noise: reset this component's labels to -1.
      for (let i = 0; i < qTail; i++) labels[queue[i]] = -1;
    }
  }
  return { labels, objects };
}
