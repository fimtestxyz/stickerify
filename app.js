import {
  labelComponents,
  upscaleNearest,
  headMaskFromCategories,
  bodyMaskFromCategories,
  groupFullBody,
} from "./segmentation.js";
import { exportTelegramPack, TELEGRAM_MAX_STICKERS } from "./telegram-export.js";

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
const CACHE_NAME = "stickerify-v1";

const MAX_WORK_DIM = 1200; // working canvas size (keeps segmentation fast)
const MIN_HEAD_PX = 400;   // ignore head blobs smaller than this (at work size)
const POOL_SIZE = Math.min(3, navigator.hardwareConcurrency || 2);

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const jobsEl = $("jobs");
const progressBox = $("model-progress");
const progressLabel = $("model-progress-label");
const progressBar = $("model-progress-bar");
const progressText = $("model-progress-text");

let jobs = []; // {id, name, file, img, status, statusText, width, height, categories, personMask, faceBoxes, segments, workCanvas, stickers, error}
let jobSeq = 0;
let segmentMode = "head"; // "head" | "full" — what to cut out
let pool = null;      // [{worker, busy}] once initialised
let poolFailed = false;
let poolError = "";   // why the pool failed, shown to the user
let modelBlobUrl = null;
let modelInfo = null; // { cached, bytes, ms } for the ready summary
let fallback = null;  // { segmenter, faceDetector } — main-thread fallback

const setStatus = (msg) => { statusEl.textContent = msg; };
const fmtMB = (n) => `${(n / 1048576).toFixed(1)} MB`;

function computeWorkSize(naturalW, naturalH) {
  const scale = Math.min(1, MAX_WORK_DIM / Math.max(naturalW, naturalH));
  return {
    w: Math.max(1, Math.round(naturalW * scale)),
    h: Math.max(1, Math.round(naturalH * scale)),
  };
}

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
    // Indeterminate phase (runtime load, warm-up, …).
    progressBar.removeAttribute("value");
    progressText.textContent = "";
  }
}

function hideProgress() { progressBox.hidden = true; }

/** Download the model with progress, caching it so repeat visits skip the download.
 * Returns { blobUrl, cached, bytes, ms }. */
async function fetchModelBlobWithProgress(url, onProgress) {
  const started = performance.now();
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch { /* Cache API unavailable — download directly. */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress(-1, -1); // cached: no download needed
      const blob = await hit.blob();
      return { blobUrl: URL.createObjectURL(blob), cached: true, bytes: blob.size, ms: performance.now() - started };
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
  return { blobUrl: URL.createObjectURL(blob), cached: false, bytes: blob.size, ms: performance.now() - started };
}

async function loadVision() {
  const { FilesetResolver } = await import(VISION_BUNDLE_URL);
  return FilesetResolver.forVisionTasks(VISION_WASM_URL);
}

// ---------------------------------------------------------------------------
// Worker pool (true concurrent batch processing)
// ---------------------------------------------------------------------------
let poolInitPromise = null;

async function ensurePool() {
  if (pool) return true;
  if (poolFailed) return false;
  if (!poolInitPromise) poolInitPromise = initPool();
  return poolInitPromise;
}

async function initPool() {
  try {
    showProgress("Downloading segmentation model…", 0, 0);
    const dl = await fetchModelBlobWithProgress(MULTICLASS_MODEL_URL, (loaded, total) => {
      if (loaded < 0) {
        showProgress("Model cached — starting workers…", 0, 0);
      } else {
        showProgress("Downloading segmentation model…", loaded, total);
      }
    });
    modelBlobUrl = dl.blobUrl;
    modelInfo = dl;
    showProgress("Starting workers…", 0, 0);
    const workers = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const worker = new Worker("./worker.js"); // classic worker: MediaPipe's WASM loader needs importScripts()
      workers.push({ worker, busy: false, ready: false, initError: "" });
    }
    const ready = await Promise.all(workers.map((w) => new Promise((resolve) => {
      const timer = setTimeout(() => { w.initError = "Timed out after 60s"; resolve(false); }, 60000);
      w.worker.onmessage = (e) => {
        if (e.data.type === "ready") { w.ready = true; clearTimeout(timer); resolve(true); }
        else if (e.data.type === "error") { w.initError = e.data.error || "Unknown worker error"; clearTimeout(timer); resolve(false); }
        else handleWorkerMessage(w, e.data);
      };
      w.worker.onerror = () => { w.initError = "Worker script failed to load"; clearTimeout(timer); resolve(false); };
      w.worker.postMessage({ type: "init" });
    })));
    pool = workers.filter((w, i) => ready[i]);
    if (!pool.length) {
      poolError = workers.map((w) => w.initError).filter(Boolean).join("; ") || "No workers became ready";
      throw new Error(poolError);
    }
    showModelReady();
    return true;
  } catch (err) {
    console.warn("Worker pool unavailable, falling back to main-thread processing:", err);
    poolFailed = true;
    if (!poolError) poolError = String(err?.message || err);
    hideProgress();
    return false;
  }
}

/** Leave a short "model ready" summary visible so a fast download is still seen. */
function showModelReady() {
  if (!modelInfo) { hideProgress(); return; }
  progressLabel.textContent = "Segmentation model ready ✓";
  progressBar.max = 100;
  progressBar.value = 100;
  progressText.textContent = modelInfo.cached
    ? "Loaded from cache — no download needed."
    : `Downloaded ${fmtMB(modelInfo.bytes)} in ${(modelInfo.ms / 1000).toFixed(1)}s — cached for next time.`;
  progressBox.hidden = false;
  setTimeout(hideProgress, 5000);
}

function handleWorkerMessage(w, data) {
  const job = jobs.find((j) => j.id === data.id);
  if (!job) { w.busy = false; return; }
  w.busy = false;
  if (data.type === "done") {
    job.width = data.width;
    job.height = data.height;
    job.categories = data.categories; // raw multiclass mask; stickers are derived per mode
    finishJob(job);
  } else if (data.type === "error") {
    console.warn(`Worker failed on ${job.name}, retrying on main thread:`, data.error);
    job.status = "queued";
    job.retried = true;
    setJobStatus(job, "Worker failed — retrying…");
    processOnMainThread(job).finally(pumpQueue);
  }
  pumpQueue();
}

// ---------------------------------------------------------------------------
// Main-thread fallback (single segmenter, then binary + face detection)
// ---------------------------------------------------------------------------
async function loadMainSegmenter() {
  const { ImageSegmenter } = await import(VISION_BUNDLE_URL);
  const vision = await loadVision();
  if (!modelBlobUrl) {
    showProgress("Downloading segmentation model…", 0, 0);
    const dl = await fetchModelBlobWithProgress(MULTICLASS_MODEL_URL, (loaded, total) => {
      if (loaded < 0) showProgress("Model cached — warming up…", 0, 0);
      else showProgress("Downloading segmentation model…", loaded, total);
    });
    modelBlobUrl = dl.blobUrl;
    modelInfo = dl;
  }
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelBlobUrl, delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
  hideProgress();
  return segmenter;
}

async function loadFallbackModels() {
  if (fallback) return fallback;
  const { ImageSegmenter, FaceDetector } = await import(VISION_BUNDLE_URL);
  const vision = await loadVision();
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

let mainSegmenter = null;

async function segmentOnMainThread(job) {
  const { w, h } = computeWorkSize(job.img.naturalWidth, job.img.naturalHeight);
  const canvas = drawWorkCanvas(job, w, h);
  try {
    if (!mainSegmenter) mainSegmenter = await loadMainSegmenter();
    const result = mainSegmenter.segment(canvas);
    const maskImg = result.categoryMask;
    const categories = upscaleNearest(maskImg.getAsUint8Array(), maskImg.width, maskImg.height, w, h);
    return { width: w, height: h, categories };
  } catch (err) {
    console.warn("Multiclass segmentation failed, trying binary + face fallback:", err);
    const { segmenter: seg, faceDetector: det } = await loadFallbackModels();
    const result = seg.segment(canvas);
    const maskImg = result.categoryMask;
    const person = upscaleNearest(maskImg.getAsUint8Array(), maskImg.width, maskImg.height, w, h);
    const detections = det.detect(canvas).detections || [];
    const faceBoxes = detections.map((d) => {
      const b = d.boundingBox;
      return {
        x0: Math.max(0, Math.floor(b.originX - b.width * 0.35)),
        y0: Math.max(0, Math.floor(b.originY - b.height * 0.6)),
        x1: Math.min(w, Math.ceil(b.originX + b.width * 1.35)),
        y1: Math.min(h, Math.ceil(b.originY + b.height * 1.4)),
      };
    });
    return { width: w, height: h, personMask: person, faceBoxes };
  }
}

/** Derive the stickers for a job from its stored raw masks, in the current mode.
 * Multiclass path: the categories array. Binary fallback path: person mask + face boxes. */
function computeStickers(job) {
  const w = job.width, h = job.height;
  if (job.categories) {
    if (segmentMode === "full") {
      const head = headMaskFromCategories(job.categories);
      const body = bodyMaskFromCategories(job.categories);
      return groupFullBody(head, body, w, h, MIN_HEAD_PX)
        .map((p, i) => ({ ...p, name: `Person ${i + 1}` }));
    }
    return componentsToSegments(headMaskFromCategories(job.categories), w, h, "Head");
  }
  if (job.personMask) {
    if (segmentMode === "full") {
      return componentsToSegments(job.personMask, w, h, "Person");
    }
    return job.faceBoxes.map((b, i) => {
      const mask = new Uint8Array(w * h);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) if (job.personMask[y * w + x]) mask[y * w + x] = 1;
      }
      return { bbox: { minX: b.x0, minY: b.y0, maxX: b.x1 - 1, maxY: b.y1 - 1 }, mask, name: `Head ${i + 1}` };
    }).filter((s) => countOnes(s.mask) >= MIN_HEAD_PX);
  }
  return [];
}

function componentsToSegments(mask, w, h, label) {
  const { labels, components } = labelComponents(mask, w, h, MIN_HEAD_PX);
  return components.map((c, i) => {
    const m = new Uint8Array(w * h);
    for (let p = 0; p < mask.length; p++) if (labels[p] === c.id) m[p] = 1;
    return { bbox: c, mask: m, name: `${label} ${i + 1}` };
  });
}

const noSegmentsText = () => segmentMode === "full"
  ? "No people found — try a photo with a person fully in frame."
  : "No heads found — try a photo with faces visible, facing the camera.";
const doneText = (n) => `Done — ${n} sticker${n > 1 ? "s" : ""} ready.`;

function countOnes(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------
function drawWorkCanvas(job, w, h) {
  if (job.workCanvas && job.workCanvas.width === w) return job.workCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(job.img, 0, 0, w, h);
  job.workCanvas = canvas;
  return canvas;
}

function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) {
    setStatus("That doesn't look like an image — try JPG, PNG, or WebP photos.");
    return;
  }
  $("workbench").hidden = false;
  for (const file of images) {
    const job = {
      id: ++jobSeq,
      name: file.name || `Photo ${jobSeq}`,
      file,
      img: null,
      status: "queued",
      segments: [],
      stickers: [],
    };
    jobs.push(job);
    renderJobCard(job);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      job.img = img;
      setJobStatus(job, "Queued");
      kick();
    };
    img.onerror = () => {
      job.status = "failed";
      setJobStatus(job, "Could not read this image.");
      updateSummary();
    };
    img.src = url;
  }
  updateSummary();
  kick();
}

let fallbackRunning = false;

async function processQueue() {
  const ok = await ensurePool();
  if (ok) { pumpQueue(); return; }
  // Sequential main-thread fallback.
  if (fallbackRunning) return;
  fallbackRunning = true;
  setStatus(`Workers unavailable${poolError ? ` (${poolError})` : ""} — processing photos one by one on the main thread.`);
  try {
    for (;;) {
      const next = jobs.find((j) => j.status === "queued" && j.img);
      if (!next) break;
      await processOnMainThread(next);
    }
  } finally {
    fallbackRunning = false;
  }
  updateSummary();
  kick(); // pick up anything that finished loading while we worked
}

/** Central dispatcher: called whenever a job becomes ready or the pool state changes. */
function kick() {
  if (pool) { pumpQueue(); return; }
  if (poolFailed) {
    if (!fallbackRunning && jobs.some((j) => j.status === "queued" && j.img)) processQueue();
    return;
  }
  processQueue();
}

function pumpQueue() {
  if (!pool) return;
  for (const job of jobs) {
    if (job.status !== "queued" || !job.img) continue;
    const w = pool.find((x) => !x.busy && x.ready);
    if (!w) return;
    w.busy = true;
    job.status = "processing";
    job.worker = w;
    setJobStatus(job, "Segmenting…");
    createImageBitmap(job.file)
      .then((bitmap) => w.worker.postMessage({ type: "segment", id: job.id, bitmap }, [bitmap]))
      .catch((err) => {
        w.busy = false;
        console.warn(`Could not hand ${job.name} to a worker:`, err);
        job.status = "queued";
        processOnMainThread(job).finally(pumpQueue);
      });
  }
}

async function processOnMainThread(job) {
  if (job.status === "done" || job.status === "failed") return;
  job.status = "processing";
  setJobStatus(job, "Segmenting…");
  try {
    const result = await segmentOnMainThread(job);
    job.width = result.width;
    job.height = result.height;
    job.categories = result.categories || null;
    job.personMask = result.personMask || null;
    job.faceBoxes = result.faceBoxes || null;
    finishJob(job);
  } catch (err) {
    console.error(err);
    job.status = "failed";
    setJobStatus(job, `Failed: ${err?.message || err}`);
    updateSummary();
  }
}

function finishJob(job) {
  job.status = "done";
  job.segments = computeStickers(job);
  if (!job.segments.length) {
    setJobStatus(job, noSegmentsText());
  } else {
    setJobStatus(job, doneText(job.segments.length));
    renderJobStickers(job);
  }
  updateSummary();
  pumpQueue();
}

/** Re-derive stickers for finished jobs (e.g. after the mode changes). */
function refreshDoneJobs() {
  for (const job of jobs.filter((j) => j.status === "done")) {
    job.segments = computeStickers(job);
    if (!job.segments.length) {
      setJobStatus(job, noSegmentsText());
      job.card.querySelector(".job-stickers").innerHTML = "";
    } else {
      setJobStatus(job, doneText(job.segments.length));
      renderJobStickers(job);
    }
  }
  updateSummary();
}

function updateSummary() {
  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const active = jobs.filter((j) => j.status === "processing" || j.status === "queued").length;
  if (!jobs.length) { setStatus(""); return; }
  const stickers = jobs.reduce((n, j) => n + (j.segments || []).length, 0);
  setStatus(
    `${jobs.length} photo${jobs.length > 1 ? "s" : ""} · ${done} done · ${active} in progress · ${failed} failed · ${stickers} sticker${stickers === 1 ? "" : "s"} — photos stay on your device, nothing was uploaded.`,
  );
}

// ---------------------------------------------------------------------------
// Sticker rendering (per job)
// ---------------------------------------------------------------------------
function blurAlpha(alpha, w, h, radius) {
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
  for (let i = 0; i < mask.length; i++) img.data[i * 4 + 3] = mask[i] ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  return c;
}

function cropMask(mask, fullW, x0, y0, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = mask[(y0 + y) * fullW + (x0 + x)];
  }
  return out;
}

function renderSticker(job, seg) {
  const outline = parseInt($("outline-width").value, 10);
  const outlineColour = $("outline-colour").value;
  const background = $("background").value;
  const shadow = $("shadow").checked;
  const smooth = $("smooth").checked;

  const { minX, minY, maxX, maxY } = seg.bbox;
  const pad = outline + (shadow ? 22 : 6) + 8;
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const W = cw + pad * 2, H = ch + pad * 2;

  const srcCtx = job.workCanvas.getContext("2d");
  const srcData = srcCtx.getImageData(minX, minY, cw, ch).data;
  let alpha = new Uint8ClampedArray(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      alpha[y * cw + x] = seg.mask[(minY + y) * job.width + (minX + x)] ? 255 : 0;
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

  // Silhouette, dilated by the outline width (offset-draw trick).
  const sil = maskCanvasFrom(cropMask(seg.mask, job.width, minX, minY, cw, ch), cw, ch);
  const dil = document.createElement("canvas");
  dil.width = W; dil.height = H;
  const dilCtx = dil.getContext("2d");
  const steps = 16;
  for (let s = 0; s < steps; s++) {
    const a = (s / steps) * Math.PI * 2;
    dilCtx.drawImage(sil, pad + Math.cos(a) * outline, pad + Math.sin(a) * outline);
  }
  dilCtx.drawImage(sil, pad, pad);
  dilCtx.globalCompositeOperation = "source-in";
  dilCtx.fillStyle = outlineColour;
  dilCtx.fillRect(0, 0, W, H);
  dilCtx.globalCompositeOperation = "source-over";

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

function renderJobStickers(job) {
  const { w, h } = computeWorkSize(job.img.naturalWidth, job.img.naturalHeight);
  drawWorkCanvas(job, w, h);
  job.width = w;
  job.height = h;
  job.stickers = job.segments.map((seg) => ({ canvas: renderSticker(job, seg), name: seg.name, include: true }));
  const list = job.card.querySelector(".job-stickers");
  list.innerHTML = "";
  job.stickers.forEach((st) => {
    const card = document.createElement("div");
    card.className = "sticker";
    const img = document.createElement("img");
    img.src = st.canvas.toDataURL("image/png");
    img.alt = `${job.name} — ${st.name}`;
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
    list.appendChild(card);
  });
}

function renderAllStickers() {
  for (const job of jobs.filter((j) => j.status === "done" && (j.segments || []).length)) renderJobStickers(job);
}

// ---------------------------------------------------------------------------
// Job cards
// ---------------------------------------------------------------------------
function renderJobCard(job) {
  const card = document.createElement("div");
  card.className = "job";
  card.id = `job-${job.id}`;
  const thumb = document.createElement("img");
  thumb.className = "job-thumb";
  thumb.alt = job.name;
  thumb.src = URL.createObjectURL(job.file);
  const head = document.createElement("div");
  head.className = "job-head";
  const name = document.createElement("div");
  name.className = "job-name";
  name.textContent = job.name;
  const status = document.createElement("div");
  status.className = "job-status";
  status.textContent = "Loading…";
  head.append(name, status);
  const stickers = document.createElement("div");
  stickers.className = "job-stickers";
  card.append(thumb, head, stickers);
  jobsEl.appendChild(card);
  job.card = card;
  job.statusEl = status;
}

function setJobStatus(job, text) {
  job.statusText = text;
  if (job.statusEl) job.statusEl.textContent = text;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => downloadBlob(blob, filename), "image/png");
}

$("export-telegram").addEventListener("click", async () => {
  const included = jobs.flatMap((j) => j.stickers).filter((s) => s.include);
  if (!included.length) { setStatus("Tick at least one sticker to export."); return; }
  const btn = $("export-telegram");
  btn.disabled = true;
  setStatus("Preparing your Telegram pack…");
  try {
    const { zipBlob, count, truncated, problems } = await exportTelegramPack(included.map((s) => s.canvas));
    downloadBlob(zipBlob, "stickerify-telegram-pack.zip");
    $("telegram-guide").hidden = false;
    $("telegram-guide").scrollIntoView({ behavior: "smooth", block: "nearest" });
    let msg = `Telegram pack ready — ${count} sticker${count > 1 ? "s" : ""} in the ZIP. Follow the steps below to publish it with @Stickers.`;
    if (truncated) msg += ` Only the first ${TELEGRAM_MAX_STICKERS} were included (Telegram packs hold up to ${TELEGRAM_MAX_STICKERS}).`;
    if (problems.length) msg += ` ${problems.join(" ")}`;
    setStatus(msg);
  } catch (err) {
    console.error(err);
    setStatus(`Telegram export failed: ${err?.message || err}`);
  } finally {
    btn.disabled = false;
  }
});

$("download-all").addEventListener("click", () => {
  const included = jobs.flatMap((j) => j.stickers).filter((s) => s.include);
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
  jobs = [];
  jobsEl.innerHTML = "";
  $("workbench").hidden = true;
  $("file-input").value = "";
  $("url-input").value = "";
  setStatus("");
});

// ---------------------------------------------------------------------------
// Intake: files, drag & drop, paste, URLs (one per line)
// ---------------------------------------------------------------------------
$("file-input").addEventListener("change", (e) => {
  addFiles(e.target.files);
  e.target.value = "";
});

const dropZone = $("drop-zone");
dropZone.addEventListener("click", (e) => {
  if (e.target.closest(".url-row")) return;
  $("file-input").click();
});
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag");
  addFiles(e.dataTransfer.files);
});
document.addEventListener("paste", (e) => {
  const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith("image/"));
  if (items.length) addFiles(items.map((i) => i.getAsFile()));
});

async function loadFromUrl(url) {
  setStatus("Fetching photo…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not an image");
  const name = decodeURIComponent(url.split("/").pop().split("?")[0] || "photo");
  return new File([blob], name, { type: blob.type });
}
$("url-load").addEventListener("click", async () => {
  const urls = $("url-input").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return;
  setStatus(`Fetching ${urls.length} photo${urls.length > 1 ? "s" : ""}…`);
  const files = [];
  for (const url of urls) {
    try {
      files.push(await loadFromUrl(url));
    } catch (err) {
      console.warn("URL load failed:", url, err);
      setStatus(`Could not fetch ${url} — the host may block cross-origin reads. Download the photo and upload it instead.`);
    }
  }
  if (files.length) addFiles(files);
});

// Re-derive stickers when the segment mode changes.
for (const el of document.querySelectorAll('input[name="segment-mode"]')) {
  el.addEventListener("change", () => {
    segmentMode = el.value;
    refreshDoneJobs();
  });
}

// Re-render stickers when style controls change (debounced).
let renderTimer = null;
for (const id of ["outline-width", "outline-colour", "background", "shadow", "smooth"]) {
  $(id).addEventListener("input", () => {
    $("outline-width-val").textContent = `${$("outline-width").value}px`;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAllStickers, 120);
  });
}
