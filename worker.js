// Stickerify segmentation worker.
// Runs MediaPipe image segmentation off the main thread so several photos
// can be processed concurrently (one worker per photo, up to the pool size).
// The main thread downloads and caches the model first (with a progress bar);
// workers load it from the shared Cache Storage, so the ~16 MB model is
// fetched only once per browser.
import { FilesetResolver, ImageSegmenter } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { labelComponents, upscaleNearest, headMaskFromCategories } from "./segmentation.js";

const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MULTICLASS_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const CACHE_NAME = "stickerify-v1";
const MAX_WORK_DIM = 1200;
const MIN_HEAD_PX = 400;

let segmenter = null;

async function init() {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  let modelUrl = MULTICLASS_MODEL_URL;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(MULTICLASS_MODEL_URL);
    if (hit) modelUrl = URL.createObjectURL(await hit.blob());
  } catch (err) {
    // Cache unavailable — fall back to loading the model straight from the CDN.
    console.warn("Worker cache read failed, loading model from CDN:", err);
  }
  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
    runningMode: "IMAGE",
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      await init();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", error: String(err?.message || err) });
    }
    return;
  }
  if (msg.type === "segment") {
    const { id, bitmap } = msg;
    try {
      const scale = Math.min(1, MAX_WORK_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const result = segmenter.segment(canvas);
      const maskImg = result.categoryMask;
      const head = headMaskFromCategories(maskImg.getAsUint8Array());
      const full = upscaleNearest(head, maskImg.width, maskImg.height, w, h);
      const { labels, components } = labelComponents(full, w, h, MIN_HEAD_PX);
      const heads = components.map((c) => {
        const m = new Uint8Array(w * h);
        for (let p = 0; p < full.length; p++) if (labels[p] === c.id) m[p] = 1;
        return { bbox: c, mask: m };
      });
      const transfers = heads.map((hh) => hh.mask.buffer);
      self.postMessage({ type: "done", id, width: w, height: h, heads }, transfers);
    } catch (err) {
      self.postMessage({ type: "error", id, error: String(err?.message || err) });
    }
  }
};
