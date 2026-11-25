// Node tests for segmentation.js (DOM-free). Run: node test/segmentation.test.mjs
import assert from "node:assert";
import {
  labelComponents,
  dilateMask,
  upscaleNearest,
  headMaskFromCategories,
  bodyMaskFromCategories,
  groupFullBody,
  objectsFromCategories,
  DEEPLAB_CATEGORIES,
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

// --- objectsFromCategories: helpers ---
function catGrid(rows) {
  const h = rows.length, w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { m[y * w + x] = Number(ch); }));
  return { mask: m, w, h };
}

// Two objects, different categories: split by category, bboxes + labels right.
{
  const { mask, w, h } = catGrid([
    "11....",
    "11....",
    "....22",
    "....22",
  ]);
  const { labels, objects } = objectsFromCategories(mask, w, h, 1);
  assert.equal(objects.length, 2, "two objects");
  assert.equal(objects[0].category, 1, "first object is category 1");
  assert.equal(objects[0].count, 4, "first object has 4 px");
  assert.deepEqual(
    [objects[0].bbox.minX, objects[0].bbox.minY, objects[0].bbox.maxX, objects[0].bbox.maxY],
    [0, 0, 1, 1],
  );
  assert.equal(objects[1].category, 2, "second object is category 2");
  assert.deepEqual(
    [objects[1].bbox.minX, objects[1].bbox.minY, objects[1].bbox.maxX, objects[1].bbox.maxY],
    [4, 2, 5, 3],
  );
  assert.equal(labels[0], 0, "top-left pixel belongs to object 0");
  assert.equal(labels[3 * w + 5], 1, "bottom-right pixel belongs to object 1");
  assert.equal(labels[2 * w + 2], -1, "background pixel has no object");
}

// Two separate blobs of the SAME category: split into two instances.
{
  const { mask, w, h } = catGrid([
    "88..88",
    "88..88",
  ]);
  const { objects } = objectsFromCategories(mask, w, h, 1);
  assert.equal(objects.length, 2, "same-category blobs are separate objects");
  assert.equal(objects[0].category, 8, "both are category 8");
  assert.equal(objects[1].category, 8, "both are category 8");
  assert.equal(objects[0].count, 4, "each has 4 px");
}

// Touching blobs of different categories stay separate (category boundary splits).
{
  const { mask, w, h } = catGrid([
    "1122",
    "1122",
  ]);
  const { objects } = objectsFromCategories(mask, w, h, 1);
  assert.equal(objects.length, 2, "adjacent different categories do not merge");
}

// Diagonal pixels of the same category are NOT connected (4-connectivity).
{
  const { mask, w, h } = catGrid([
    "8.",
    ".8",
  ]);
  const { objects } = objectsFromCategories(mask, w, h, 1);
  assert.equal(objects.length, 2, "diagonal pixels are separate objects");
}

// Tiny blob dropped by minPixels; its labels reset to -1.
{
  const { mask, w, h } = catGrid([
    "88....",
    "88....",
    "....8.",
  ]);
  const { labels, objects } = objectsFromCategories(mask, w, h, 2);
  assert.equal(objects.length, 1, "1 px speck dropped by the size filter");
  assert.equal(labels[2 * w + 4], -1, "dropped speck pixel has label -1");
}

// Background-only mask yields no objects.
{
  const { mask, w, h } = catGrid(["000", "000"]);
  const { objects } = objectsFromCategories(mask, w, h, 1);
  assert.equal(objects.length, 0, "no objects in an all-background mask");
}

// --- DEEPLAB_CATEGORIES: PASCAL VOC 21 classes ---
{
  assert.equal(DEEPLAB_CATEGORIES.length, 21, "21 DeepLab categories");
  assert.equal(DEEPLAB_CATEGORIES[0], "background");
  assert.equal(DEEPLAB_CATEGORIES[5], "bottle");
  assert.equal(DEEPLAB_CATEGORIES[8], "cat");
  assert.equal(DEEPLAB_CATEGORIES[12], "dog");
  assert.equal(DEEPLAB_CATEGORIES[15], "person");
  assert.equal(DEEPLAB_CATEGORIES[20], "tv");
}

console.log("objectsFromCategories: all tests passed");
