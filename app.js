import {
  labelComponents,
  upscaleNearest,
  headMaskFromCategories,
} from "./segmentation.js";

// ---------------------------------------------------------------------------
// Models (MediaPipe Tasks Vision, Apache-2.0). All run on-device in the
// browser; photos are never uploaded anywhere.
// ---------------------------------------------------------------------------
const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const VISION_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const MULTICLASS_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const SELFIE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

const MAX_WORK_DIM = 1200; // working canvas size (keeps segmentation fast)
const MIN_HEAD_PX = 400;   // ignore head blobs smaller than this (at work size)

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const sourceCanvas = $("source-canvas");
const stickerList = $("sticker-list");

let vision = null;
let segmenter = null;      // multiclass (hair + face) segmenter
let fallback = null;       // { segmenter, faceDetector } — used only if needed
let currentImage = null;   // HTMLImageElement
let heads = [];            // [{ bbox, mask, name }] at work-canvas resolution
let stickers = [];         // [{ canvas, name, include }]

const setStatus = (msg) => { statusEl.textContent = msg; };

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
async function loadVision() {
  if (vision) return vision;
  const { FilesetResolver } = await import(VISION_BUNDLE_URL);
  vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  return vision;
}

async function loadSegmenter() {
  if (segmenter) return segmenter;
  const { ImageSegmenter } = await import(VISION_BUNDLE_URL);
  await loadVision();
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MULTICLASS_MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  return segmenter;
}

async function loadFallback() {
  if (fallback) return fallback;
  const { ImageSegmenter, FaceDetector } = await import(VISION_BUNDLE_URL);
  await loadVision();
  const seg = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: SELFIE_MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  const det = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "CPU" },
    runningMode: "IMAGE",
  });
  fallback = { segmenter: seg, faceDetector: det };
  return fallback;
}

// ---------------------------------------------------------------------------
// Image intake
// ---------------------------------------------------------------------------
function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("That doesn't look like an image — try a JPG, PNG, or WebP photo.");
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    currentImage = img;
    processPhoto();
  };
  img.onerror = () => setStatus("Could not read that image. Try another file.");
  img.src = url;
}

$("file-input").addEventListener("change", (e) => loadFile(e.target.files[0]));

async function loadFromUrl(url) {
  setStatus("Fetching photo…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not an image");
  loadFile(new File([blob], "photo", { type: blob.type }));
}
$("url-load").addEventListener("click", async () => {
  const url = $("url-input").value.trim();
  if (!url) return;
  try {
    await loadFromUrl(url);
  } catch (err) {
    console.warn(err);
    setStatus("Could not fetch that URL — the host may block cross-origin reads. Download the photo and upload it instead.");
  }
});

const dropZone = $("drop-zone");
dropZone.addEventListener("click", () => $("file-input").click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag");
  loadFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) loadFile(item.getAsFile());
});

// ---------------------------------------------------------------------------
// Segmentation: find head masks at working resolution
// ---------------------------------------------------------------------------
function drawImageToWorkCanvas(img) {
  const scale = Math.min(1, MAX_WORK_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  const ctx = sourceCanvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h };
}

async function findHeads(canvas, w, h) {
  // Primary: multiclass model — head = hair + face-skin categories.
  try {
    const seg = await loadSegmenter();
    const result = seg.segment(canvas);
    const maskImg = result.categoryMask;
    const mw = maskImg.width, mh = maskImg.height;
    const cats = maskImg.getAsUint8Array();
    const head = headMaskFromCategories(cats);
    const full = upscaleNearest(head, mw, mh, w, h);
    return componentsToHeads(full, w, h);
  } catch (err) {
    console.warn("Multiclass segmentation failed, trying fallback:", err);
  }
  // Fallback: binary person mask + face boxes.
  const { segmenter: seg, faceDetector: det } = await loadFallback();
  const result = seg.segment(canvas);
  const maskImg = result.categoryMask;
  const person = upscaleNearest(maskImg.getAsUint8Array(), maskImg.width, maskImg.height, w, h);
  const detections = det.detect(canvas).detections || [];
  const headsOut = [];
  for (const d of detections) {
    const b = d.boundingBox;
    const x0 = Math.max(0, Math.floor(b.originX - b.width * 0.35));
    const y0 = Math.max(0, Math.floor(b.originY - b.height * 0.6));
    const x1 = Math.min(w, Math.ceil(b.originX + b.width * 1.35));
    const y1 = Math.min(h, Math.ceil(b.originY + b.height * 1.4));
    const mask = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (person[y * w + x]) mask[y * w + x] = 1;
      }
    }
    headsOut.push({ bbox: { minX: x0, minY: y0, maxX: x1 - 1, maxY: y1 - 1 }, mask });
  }
  return headsOut.filter((hd) => countOnes(hd.mask) >= MIN_HEAD_PX);
}

function componentsToHeads(mask, w, h) {
  const { labels, components } = labelComponents(mask, w, h, MIN_HEAD_PX);
  return components.map((c, i) => {
    const m = new Uint8Array(w * h);
    for (let p = 0; p < mask.length; p++) if (labels[p] === c.id) m[p] = 1;
    return { bbox: c, mask: m, name: `Head ${i + 1}` };
  });
}

function countOnes(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

// ---------------------------------------------------------------------------
// Sticker rendering
// ---------------------------------------------------------------------------
function blurAlpha(alpha, w, h, radius) {
  // Separable box blur on an alpha channel (Uint8ClampedArray).
  const tmp = new Float32Array(alpha.length);
  const out = new Uint8ClampedArray(alpha.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += alpha[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * radius + 1);
      const xa = Math.max(0, x - radius), xb = Math.min(w - 1, x + radius + 1);
      acc += alpha[y * w + xb] - alpha[y * w + xa];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * radius + 1);
      const ya = Math.max(0, y - radius), yb = Math.min(h - 1, y + radius + 1);
      acc += tmp[yb * w + x] - tmp[ya * w + x];
    }
  }
  return out;
}

function maskCanvasFrom(mask, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4 + 3] = mask[i] ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function renderSticker(head) {
  const outline = parseInt($("outline-width").value, 10);
  const outlineColour = $("outline-colour").value;
  const background = $("background").value;
  const shadow = $("shadow").checked;
  const smooth = $("smooth").checked;

  const { minX, minY, maxX, maxY } = head.bbox;
  const pad = outline + (shadow ? 22 : 6) + 8;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const W = cw + pad * 2, H = ch + pad * 2;

  // --- cut-out (source pixels + feathered mask alpha) ---
  const srcCtx = sourceCanvas.getContext("2d");
  const srcData = srcCtx.getImageData(minX, minY, cw, ch).data;
  let alpha = new Uint8ClampedArray(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      alpha[y * cw + x] = head.mask[(minY + y) * sourceCanvas.width + (minX + x)] ? 255 : 0;
    }
  }
  if (smooth) alpha = blurAlpha(alpha, cw, ch, 2);
  const cut = document.createElement("canvas");
  cut.width = cw; cut.height = ch;
  const cutCtx = cut.getContext("2d");
  const cutImg = cutCtx.createImageData(cw, ch);
  for (let i = 0; i < cw * ch; i++) {
    cutImg.data[i * 4] = srcData[i * 4];
    cutImg.data[i * 4 + 1] = srcData[i * 4 + 1];
    cutImg.data[i * 4 + 2] = srcData[i * 4 + 2];
    cutImg.data[i * 4 + 3] = alpha[i];
  }
  cutCtx.putImageData(cutImg, 0, 0);

  // --- silhouette, dilated by the outline width (offset-draw trick) ---
  const sil = maskCanvasFrom(cropMask(head.mask, minX, minY, cw, ch), cw, ch);
  const dil = document.createElement("canvas");
  dil.width = W; dil.height = H;
  const dilCtx = dil.getContext("2d");
  const steps = 16;
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    dilCtx.drawImage(sil, pad + Math.cos(a) * outline, pad + Math.sin(a) * outline);
  }
  dilCtx.drawImage(sil, pad, pad); // centre copy keeps thin outlines solid
  // Colour the dilated silhouette with the outline colour.
  dilCtx.globalCompositeOperation = "source-in";
  dilCtx.fillStyle = outlineColour;
  dilCtx.fillRect(0, 0, W, H);
  dilCtx.globalCompositeOperation = "source-over";

  // --- compose ---
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  if (background !== "transparent") {
    const cx = W / 2, cy = H / 2, r = Math.max(cw, ch) / 2 + outline * 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle =
      background === "white-disc" ? "#ffffff" :
      background === "black-disc" ? "#22201c" : "#ffd9e8";
    ctx.fill();
  }
  if (shadow) {
    ctx.save();
    ctx.filter = "drop-shadow(0 8px 10px rgba(0,0,0,0.35))";
    ctx.drawImage(dil, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(dil, 0, 0);
  }
  ctx.drawImage(cut, pad, pad);
  return out;
}

function cropMask(mask, x0, y0, w, h) {
  const fullW = sourceCanvas.width;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = mask[(y0 + y) * fullW + (x0 + x)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration + UI
// ---------------------------------------------------------------------------
async function processPhoto() {
  $("workbench").hidden = false;
  stickerList.innerHTML = "";
  stickers = [];
  heads = [];
  const { w, h } = drawImageToWorkCanvas(currentImage);
  setStatus("Loading the on-device model… (first run downloads ~16 MB)");
  try {
    heads = await findHeads(sourceCanvas, w, h);
  } catch (err) {
    console.error(err);
    setStatus("Segmentation failed — check your connection (the model loads from Google's CDN) and try again.");
    return;
  }
  if (!heads.length) {
    setStatus("No heads found. Try a photo where faces are visible and well lit, facing the camera.");
    return;
  }
  heads.forEach((hd, i) => { hd.name = `Head ${i + 1}`; });
  setStatus(`Found ${heads.length} head${heads.length > 1 ? "s" : ""} — styling stickers…`);
  renderAllStickers();
  setStatus(`Done — ${heads.length} sticker${heads.length > 1 ? "s" : ""} ready. Photos stay on your device; nothing was uploaded.`);
}

function renderAllStickers() {
  stickers = heads.map((head) => ({ canvas: renderSticker(head), name: head.name, include: true }));
  stickerList.innerHTML = "";
  stickers.forEach((st, i) => {
    const card = document.createElement("div");
    card.className = "sticker";
    const img = document.createElement("img");
    img.src = st.canvas.toDataURL("image/png");
    img.alt = st.name;
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => {
      st.include = box.checked;
      card.classList.toggle("off", !box.checked);
    });
    label.append(box, ` ${st.name}`);
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "dl";
    dl.textContent = "Download PNG";
    dl.addEventListener("click", () => downloadCanvas(st.canvas, `stickerify-${st.name.toLowerCase().replace(/\s+/g, "-")}.png`));
    card.append(img, label, dl);
    stickerList.appendChild(card);
  });
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}

$("download-all").addEventListener("click", () => {
  const included = stickers.filter((s) => s.include);
  if (!included.length) { setStatus("Tick at least one sticker to download."); return; }
  const cols = Math.ceil(Math.sqrt(included.length));
  const cell = Math.max(...included.map((s) => Math.max(s.canvas.width, s.canvas.height)));
  const sheet = document.createElement("canvas");
  sheet.width = cell * cols;
  sheet.height = cell * Math.ceil(included.length / cols);
  const ctx = sheet.getContext("2d");
  included.forEach((s, i) => {
    const x = (i % cols) * cell + (cell - s.canvas.width) / 2;
    const y = Math.floor(i / cols) * cell + (cell - s.canvas.height) / 2;
    ctx.drawImage(s.canvas, x, y);
  });
  downloadCanvas(sheet, "stickerify-sheet.png");
});

$("new-photo").addEventListener("click", () => {
  $("workbench").hidden = true;
  $("file-input").value = "";
  currentImage = null;
  setStatus("");
});

// Re-render stickers when style controls change (debounced).
let renderTimer = null;
for (const id of ["outline-width", "outline-colour", "background", "shadow", "smooth"]) {
  $(id).addEventListener("input", () => {
    $("outline-width-val").textContent = `${$("outline-width").value}px`;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { if (heads.length) renderAllStickers(); }, 120);
  });
}
