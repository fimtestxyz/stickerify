// Node tests for segmentation.js (DOM-free). Run: node test/segmentation.test.mjs
import assert from "node:assert";
import {
  labelComponents,
  dilateMask,
  upscaleNearest,
  headMaskFromCategories,
  CATEGORY,
} from "../segmentation.js";

function grid(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { m[y * w + x] = ch === "#" ? 1 : 0; }));
  return { mask: m, w, h };
}

// --- labelComponents: two separate blobs, one noise speck ---
{
  const { mask, w, h } = grid([
    "##....##",
    "##....##",
    "........",
    "....#...",
    "........",
  ]);
  const { components } = labelComponents(mask, w, h, 2);
  assert.equal(components.length, 2, "two blobs survive the size filter");
  assert.equal(components[0].count, 4, "largest blob has 4 px");
  assert.equal(components[1].count, 4, "second blob has 4 px");
  assert.deepEqual(
    [components[0].minX, components[0].minY, components[0].maxX, components[0].maxY],
    [0, 0, 1, 1],
  );
}

// --- labelComponents: diagonal pixels are NOT connected (4-connectivity) ---
{
  const { mask, w, h } = grid(["#.", ".#"]);
  const { components } = labelComponents(mask, w, h, 1);
  assert.equal(components.length, 2, "diagonal pixels are separate components");
}

// --- dilateMask: 1px radius grows a single pixel to 3x3 ---
{
  const { mask, w, h } = grid(["...", ".#.", "..."]);
  const d = dilateMask(mask, w, h, 1);
  assert.equal(d.reduce((a, b) => a + b, 0), 9, "dilated to 3x3");
}

// --- upscaleNearest: no blending, exact index copy ---
{
  const src = new Uint8Array([1, 2, 3, 4]);
  const dst = upscaleNearest(src, 2, 2, 4, 4);
  assert.equal(dst[0], 1);
  assert.equal(dst[3], 2);
  assert.equal(dst[12], 3);
  assert.equal(dst[15], 4);
}

// --- headMaskFromCategories: hair + face only ---
{
  const cats = new Uint8Array([
    CATEGORY.BACKGROUND, CATEGORY.HAIR, CATEGORY.BODY_SKIN,
    CATEGORY.FACE_SKIN, CATEGORY.CLOTHES, CATEGORY.OTHER,
  ]);
  assert.deepEqual([...headMaskFromCategories(cats)], [0, 1, 0, 1, 0, 0]);
}

console.log("segmentation.js: all tests passed");
