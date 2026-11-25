// Stickerify — segment objects page.
// Upload one photo, remove its background with an on-device DeepLabV3
// model, split the foreground into individual objects, and download the
// selected ones as PNGs (bulk ZIP) or a Telegram pack. The photo never
// leaves this device: the model runs in a Web Worker, the cut-outs are
// drawn on canvases, and the ZIP is built locally.
import { objectsFromCategories, DEEPLAB_CATEGORIES } from "./segmentation.js";
import { fetchImageBlob } from "./urlfetch.js";
import { createZip } from "./zip.js";
import { exportTelegramPack } from "./telegram-export.js";

const $ = (id) => document.getElementById(id);
const DEEPLAB_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite";
const CACHE_NAME = "stickerify-v1";
const MAX_WORK_DIM = 1200; // longest side of the working copy (matches worker.js)
const MIN_PIXELS = 100;    // smaller blobs are noise, not objects
const MAX_OBJECTS = 60;    // cap the grid; largest objects first
const PAD = 8;             // transparent padding around each cut-out, px at work size

const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`;

const dropZone = $("drop-zone");
const fileInput = $("file-input");
const urlInput = $("url-input");
const progressBox = $("model-progress");
const progressLabel = $("model-progress-label");
const progressBar = $("model-progress-bar");
const progressText = $("model-progress-text");
const results = $("results");
const statusEl = $("status");
const bgCanvas = $("bg-removed");
const objectsGrid = $("objects-grid");
const objectsCount = $("objects-count");

let worker = null;      // the deeplab worker, once ready
let workerPromise = null;
let busy = false;
let workCanvas = null;  // downscaled source photo (work size)
let workW = 0, workH = 0;
let labels = null;      // Int32Array: per-pixel object id (-1 = none)
let displayObjects = []; // objects sorted largest-first (labels index by id)
let selected = new Set(); // object ids
let photoBase = "photo";

// ---------------------------------------------------------------------------
// Model download with live progress (fetch + Cache API)
// ---------------------------------------------------------------------------
function showProgress(label, loaded, total) {
  progressBox.hidden = false;
  progressLabel.textContent = label;
  if (total > 0) {
    progressBar.max = 100;
    progressBar.value = Math.round((loaded / total) * 100);
    progressText.textContent = `${Math.round((loaded / total) * 100)}% · ${fmtMB(loaded)} / ${fmtMB(total)}`;
  } else if (loaded > 0) {
    progressBar.removeAttribute("value");
    progressText.textContent = fmtMB(loaded);
  } else {
    progressBar.removeAttribute("value");
    progressText.textContent = "";
  }
}

function hideProgress() { progressBox.hidden = true; }

/** Download the model with progress, caching it so repeat visits skip the download. */
async function fetchModelBlobWithProgress(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch { /* Cache API unavailable — download directly. */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress(-1, -1); // cached: no download needed
      return URL.createObjectURL(await hit.blob());
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("Content-Length") || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const blob = new Blob(chunks);
  if (cache) { try { await cache.put(url, new Response(blob)); } catch { /* non-fatal */ } }
  return URL.createObjectURL(blob);
}

/** Start the deeplab worker (downloading the ~2.7 MB model first if needed). */
async function ensureWorker() {
  if (worker) return worker;
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    showProgress("Downloading segmentation model…", 0, 0);
    await fetchModelBlobWithProgress(DEEPLAB_MODEL_URL, (loaded, total) => {
      if (loaded < 0) showProgress("Model cached — starting worker…", 0, 0);
      else showProgress("Downloading segmentation model…", loaded, total);
    });
    showProgress("Starting worker…", 0, 0);
    const w = new Worker("./worker.js"); // classic worker: MediaPipe's WASM loader needs importScripts()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Worker timed out after 60s")), 60000);
      w.onmessage = (e) => {
        if (e.data.type === "ready") { clearTimeout(timer); w.onmessage = null; resolve(); }
        else if (e.data.type === "error") { clearTimeout(timer); reject(new Error(e.data.error || "Worker failed to start")); }
      };
      w.onerror = () => { clearTimeout(timer); reject(new Error("Worker script failed to load")); };
      w.postMessage({ type: "init", model: "deeplab" });
    });
    showProgress("Segmentation model ready ✓", 0, 0);
    progressBar.max = 100;
    progressBar.value = 100;
    setTimeout(hideProgress, 3000);
    worker = w;
    return w;
  })();
  return workerPromise;
}

// ---------------------------------------------------------------------------
// Photo loading
// ---------------------------------------------------------------------------
function setStatus(msg) { statusEl.textContent = msg; }

async function loadPhotoBlob(blob, name) {
  if (busy) { setStatus("Still processing the last photo — one moment…"); return; }
  busy = true;
  results.hidden = true;
  objectsGrid.innerHTML = "";
  photoBase = (name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "-").slice(0, 40) || "photo";
  try {
    setStatus("Loading photo…");
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(bitmap.width, bitmap.height));
    workW = Math.max(1, Math.round(bitmap.width * scale));
    workH = Math.max(1, Math.round(bitmap.height * scale));
    workCanvas = document.createElement("canvas");
    workCanvas.width = workW;
    workCanvas.height = workH;
    workCanvas.getContext("2d").drawImage(bitmap, 0, 0, workW, workH);
    bitmap.close();

    const w = await ensureWorker();
    setStatus("Removing background and finding objects…");
    const sendBitmap = await createImageBitmap(workCanvas);
    const categories = await new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.type === "done") { w.removeEventListener("message", onMsg); resolve(e.data); }
        else if (e.data.type === "error") { w.removeEventListener("message", onMsg); reject(new Error(e.data.error || "Segmentation failed")); }
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ type: "segment", id: 1, bitmap: sendBitmap }, [sendBitmap]);
    });
    renderResults(categories.categories, categories.width, categories.height);
  } catch (err) {
    console.warn("Segment-objects failed:", err);
    setStatus(`Could not process that photo: ${err?.message || err}`);
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------------------
// Masks and cut-outs
// ---------------------------------------------------------------------------
// Two passes of a 3x3 box blur over a 0..255 mask — softens the stair-step
// edges of the 256x256 model mask after it is upscaled to work size.
function feather(mask, w, h) {
  let cur = mask;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            sum += cur[ny * w + nx];
            n++;
          }
        }
        next[y * w + x] = Math.round(sum / n);
      }
    }
    cur = next;
  }
  return cur;
}

/** Cut one object out of the work photo: bbox + padding, transparent outside the (feathered) object mask. */
function cutOutObject(obj) {
  const { minX, minY, maxX, maxY } = obj.bbox;
  const sx = Math.max(0, minX - PAD), sy = Math.max(0, minY - PAD);
  const ex = Math.min(workW - 1, maxX + PAD), ey = Math.min(workH - 1, maxY + PAD);
  const cw = ex - sx + 1, ch = ey - sy + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(workCanvas, sx, sy, cw, ch, 0, 0, cw, ch);
  // Binary mask for this object over the crop, then feathered for soft edges.
  const raw = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (labels[(sy + y) * workW + (sx + x)] === obj.id) raw[y * cw + x] = 255;
    }
  }
  const alpha = feather(raw, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function slugifyCategory(name) {
  return name.replace(/\s+/g, "-").toLowerCase();
}

function objectFileName(obj, index) {
  return `object-${String(index + 1).padStart(2, "0")}-${slugifyCategory(DEEPLAB_CATEGORIES[obj.category])}.png`;
}

// ---------------------------------------------------------------------------
// Rendering + selection
// ---------------------------------------------------------------------------
function renderResults(categories, w, h) {
  const { labels: foundLabels, objects } = objectsFromCategories(categories, w, h, MIN_PIXELS);
  labels = foundLabels;
  displayObjects = [...objects].sort((a, b) => b.count - a.count).slice(0, MAX_OBJECTS);
  selected = new Set(displayObjects.map((o) => o.id));
  results.hidden = false;

  // Background-removed full preview: foreground = any recognised category.
  const rawFg = new Uint8Array(w * h);
  for (let i = 0; i < categories.length; i++) rawFg[i] = categories[i] ? 255 : 0;
  const fgAlpha = feather(rawFg, w, h);
  bgCanvas.width = w;
  bgCanvas.height = h;
  const bctx = bgCanvas.getContext("2d");
  bctx.drawImage(workCanvas, 0, 0);
  const bgImg = bctx.getImageData(0, 0, w, h);
  for (let i = 0; i < fgAlpha.length; i++) bgImg.data[i * 4 + 3] = fgAlpha[i];
  bctx.putImageData(bgImg, 0, 0);

  // Object grid.
  objectsGrid.innerHTML = "";
  if (!displayObjects.length) {
    setStatus("No objects found — try a photo with a person, pet, car, bottle, chair or similar in it.");
    objectsCount.textContent = "";
    updateActions();
    return;
  }
  setStatus(`Found ${objects.length} object${objects.length === 1 ? "" : "s"}${objects.length > MAX_OBJECTS ? ` — showing the ${MAX_OBJECTS} largest` : ""}. Tap to select the ones you want.`);
  for (const obj of displayObjects) {
    obj.canvas = cutOutObject(obj);
    const tile = document.createElement("div");
    tile.className = "object-tile selected";
    tile.dataset.id = obj.id;
    tile.tabIndex = 0;
    tile.setAttribute("role", "checkbox");
    tile.setAttribute("aria-checked", "true");
    tile.title = `${DEEPLAB_CATEGORIES[obj.category]} — click to select / deselect`;
    const thumb = document.createElement("div");
    thumb.className = "checker object-thumb";
    thumb.appendChild(obj.canvas);
    const name = document.createElement("span");
    name.className = "object-name";
    name.textContent = `${DEEPLAB_CATEGORIES[obj.category]} · ${obj.canvas.width}×${obj.canvas.height}`;
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "object-dl";
    dl.textContent = "PNG ↓";
    dl.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadCanvasPng(obj.canvas, objectFileName(obj, displayObjects.indexOf(obj)));
    });
    tile.append(thumb, name, dl);
    tile.addEventListener("click", () => toggleSelect(obj.id, tile));
    tile.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleSelect(obj.id, tile); }
    });
    objectsGrid.appendChild(tile);
  }
  updateActions();
}

function toggleSelect(id, tile) {
  if (selected.has(id)) {
    selected.delete(id);
    tile.classList.remove("selected");
    tile.setAttribute("aria-checked", "false");
  } else {
    selected.add(id);
    tile.classList.add("selected");
    tile.setAttribute("aria-checked", "true");
  }
  updateActions();
}

function updateActions() {
  const total = displayObjects.length;
  objectsCount.textContent = total ? `— ${selected.size} of ${total} selected` : "";
  $("download-zip").disabled = selected.size === 0;
  $("export-telegram").disabled = selected.size === 0;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type));
}

async function downloadCanvasPng(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  if (blob) downloadBlob(blob, filename);
}

function selectedObjects() {
  return displayObjects.filter((o) => selected.has(o.id));
}

async function downloadZip() {
  const objs = selectedObjects();
  if (!objs.length) return;
  setStatus(`Preparing ${objs.length} sticker${objs.length === 1 ? "" : "s"}…`);
  const files = [];
  for (let i = 0; i < objs.length; i++) {
    const blob = await canvasToBlob(objs[i].canvas);
    files.push({ name: objectFileName(objs[i], i), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  const zipBlob = new Blob([createZip(files)], { type: "application/zip" });
  downloadBlob(zipBlob, `${photoBase}-objects.zip`);
  setStatus(`Downloaded ${objs.length} sticker${objs.length === 1 ? "" : "s"} as a ZIP.`);
}

async function exportTelegram() {
  const objs = selectedObjects();
  if (!objs.length) return;
  setStatus("Building Telegram pack…");
  const { zipBlob, count, truncated, problems } = await exportTelegramPack(objs.map((o) => o.canvas));
  downloadBlob(zipBlob, "stickerify-telegram-pack.zip");
  $("telegram-guide").hidden = false;
  setStatus(
    `Downloaded a Telegram pack with ${count} sticker${count === 1 ? "" : "s"}` +
    (truncated ? " (capped at 120)" : "") +
    (problems.length ? ` — ${problems.join(" ")}` : "") +
    ". Follow the guide below to publish it.",
  );
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadPhotoBlob(fileInput.files[0], fileInput.files[0].name);
  fileInput.value = "";
});
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag");
  const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) loadPhotoBlob(file, file.name);
  else setStatus("That drop had no image in it — try a JPG, PNG or WebP file.");
});
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
document.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) loadPhotoBlob(file, file.name || "pasted-image.png");
});
$("url-load").addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) { setStatus("Paste an image URL first."); return; }
  setStatus("Fetching image…");
  try {
    const { blob, viaProxy } = await fetchImageBlob(url);
    if (viaProxy) setStatus("Loaded through a public CORS proxy — the URL only, your photos never leave this device.");
    await loadPhotoBlob(blob, url.split("/").pop() || "url-image");
  } catch (err) {
    console.warn("URL load failed:", err);
    setStatus(`Could not load that URL: ${err?.message || err}`);
  }
});
$("select-all").addEventListener("click", () => {
  selected = new Set(displayObjects.map((o) => o.id));
  objectsGrid.querySelectorAll(".object-tile").forEach((t) => { t.classList.add("selected"); t.setAttribute("aria-checked", "true"); });
  updateActions();
});
$("select-none").addEventListener("click", () => {
  selected = new Set();
  objectsGrid.querySelectorAll(".object-tile").forEach((t) => { t.classList.remove("selected"); t.setAttribute("aria-checked", "false"); });
  updateActions();
});
$("download-zip").addEventListener("click", downloadZip);
$("export-telegram").addEventListener("click", exportTelegram);
$("download-bg").addEventListener("click", () => downloadCanvasPng(bgCanvas, `${photoBase}-no-bg.png`));
$("new-photo").addEventListener("click", () => {
  results.hidden = true;
  $("telegram-guide").hidden = true;
  objectsGrid.innerHTML = "";
  displayObjects = [];
  selected = new Set();
  labels = null;
  workCanvas = null;
  setStatus("");
  window.scrollTo({ top: 0, behavior: "smooth" });
});
