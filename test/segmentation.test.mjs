// Node tests for segmentation.js (DOM-free). Run: node test/segmentation.test.mjs
import assert from "node:assert";
import {
  labelComponents,
  dilateMask,
  upscaleNearest,
  headMaskFromCategories,
  bodyMaskFromCategories,
  groupFullBody,
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

// --- bodyMaskFromCategories: body skin + clothes only ---
{
  const cats = new Uint8Array([
    CATEGORY.BACKGROUND, CATEGORY.HAIR, CATEGORY.BODY_SKIN,
    CATEGORY.FACE_SKIN, CATEGORY.CLOTHES, CATEGORY.OTHER,
  ]);
  assert.deepEqual([...bodyMaskFromCategories(cats)], [0, 0, 1, 0, 1, 0]);
}

// --- groupFullBody: head + torso + legs merge into one person ---
{
  const W = 20, H = 20;
  const head = new Uint8Array(W * H);
  const body = new Uint8Array(W * H);
  const fill = (m, x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
  };
  fill(head, 8, 0, 11, 3);    // head
  fill(body, 7, 5, 12, 10);   // torso, 1px gap below head
  fill(body, 8, 12, 9, 18);   // left leg, 1px gap below torso
  fill(body, 10, 12, 11, 18); // right leg
  const persons = groupFullBody(head, body, W, H, 4);
  assert.equal(persons.length, 1, "one person from head + torso + legs");
  assert.equal(persons[0].mask.reduce((a, b) => a + b, 0), 4 * 4 + 6 * 6 + 2 * 7 + 2 * 7, "mask covers all parts");
  assert.deepEqual(
    [persons[0].bbox.minX, persons[0].bbox.minY, persons[0].bbox.maxX, persons[0].bbox.maxY],
    [7, 0, 12, 18],
  );
}

// --- groupFullBody: two distant people stay separate; a far body blob is its own person ---
{
  const W = 40, H = 20;
  const head = new Uint8Array(W * H);
  const body = new Uint8Array(W * H);
  const fill = (m, x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
  };
  fill(head, 2, 0, 5, 3);
  fill(body, 1, 5, 6, 10);
  fill(head, 30, 0, 33, 3);
  fill(body, 29, 5, 34, 10);
  fill(body, 16, 14, 19, 18); // headless torso, far from both heads
  const persons = groupFullBody(head, body, W, H, 4);
  assert.equal(persons.length, 3, "two people plus one headless body");
  assert.equal(persons.filter((p) => p.mask.reduce((a, b) => a + b, 0) === 4 * 4 + 6 * 6).length, 2, "both headed persons are complete");
}

console.log("segmentation.js: all tests passed");
