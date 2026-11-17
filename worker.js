// Stickerify segmentation worker.
// Runs MediaPipe image segmentation off the main thread so several photos
// can be processed concurrently (one worker per photo, up to the pool size).
// The main thread downloads and caches the model first (with a progress bar);
// workers load it from the shared Cache Storage, so the ~16 MB model is
// fetched only once per browser.
//
// IMPORTANT: this must be a CLASSIC worker (no { type: "module" }).
// MediaPipe's WASM loader uses importScripts(), which module workers forbid
// ("Module scripts don't support importScripts()"). ES modules are loaded
// here with dynamic import() instead, which classic workers support.
const VISION_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const VISION_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const MULTICLASS_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const CACHE_NAME = "stickerify-v1";
const MAX_WORK_DIM = 1200;

let FilesetResolver, ImageSegmenter;
let upscaleNearest;
let segmenter = null;

async function init() {
  ({ FilesetResolver, ImageSegmenter } = await import(VISION_BUNDLE_URL));
  ({ upscaleNearest } = await import("./segmentation.js"));
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
      // Return the raw multiclass mask (upscaled to work size); the main
      // thread derives head or full-body stickers from it per the mode.
      const categories = upscaleNearest(maskImg.getAsUint8Array(), maskImg.width, maskImg.height, w, h);
      self.postMessage({ type: "done", id, width: w, height: h, categories }, [categories.buffer]);
    } catch (err) {
      self.postMessage({ type: "error", id, error: String(err?.message || err) });
    }
  }
};
