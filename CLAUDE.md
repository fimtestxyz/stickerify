# Stickerify — agent notes

Static web app: upload photos of people (especially toddlers and kids), cut
out heads (or whole people) with on-device MediaPipe segmentation, and turn
them into stickers. No build step, no server, no dependencies to install —
plain ES modules served as static files.

## Hard rules

- **Photos never leave the device.** Segmentation runs in the browser with
  on-device models. Never add an upload, a backend call, tracking, or
  analytics. This matters most for photos of children.
- **No identification.** The app finds head/body shapes only (hair + face,
  or body-skin + clothes). Never add face recognition or identity features.
- **No scraping.** Flaticon blocks automated fetching and its terms forbid
  scraping; allsvgicons is an aggregator with mixed licensing and no stable
  API. Artwork comes only from public APIs/CDNs meant to be fetched:
  OpenMoji via jsDelivr, Iconify via `api.iconify.design`.

## Layout

| File | What it does |
| --- | --- |
| `index.html` | Page structure: upload, workbench, costume/props controls, export |
| `app.js` | UI + orchestration: jobs, rendering, costumes, props, exports |
| `worker.js` | Classic Web Worker running MediaPipe (must stay classic: the WASM loader needs `importScripts()`, which module workers forbid) |
| `segmentation.js` | DOM-free mask helpers: connected components, head/body masks, full-body grouping |
| `costumes.js` | Vector cartoon bodies drawn in canvas (no image assets) |
| `props.js` | Live props list + head-placement math + draw order |
| `iconify.js` | Live Iconify search: keyword search + SVG fetch over 200+ open sets |
| `urlfetch.js` | URL loader: direct fetch first, then public CORS proxies (AllOrigins, CodeTabs) when the host sends no Access-Control-Allow-Origin header |
| `telegram-export.js` | Telegram pack export (512px long side, ≤512 KB/sticker) |
| `zip.js` | Dependency-free STORE ZIP writer + crc32 |
| `test/*.test.mjs` | Node unit tests, one per module |

## Models (verified live)

- Runtime `@mediapipe/tasks-vision@0.10.14` via jsDelivr.
- Primary: multiclass selfie segmentation — categories 0 background, 1 hair,
  2 body-skin, 3 face-skin, 4 clothes, 5 other. **Head = hair (1) + face-skin (3).**
- Fallback: binary selfie segmenter ∩ expanded BlazeFace boxes.
- **CPU delegate throughout** — the GPU delegate scrambles multiclass
  categories on iOS Safari.

## How to test

```bash
node --check app.js && node --check worker.js && node --check segmentation.js
node --check telegram-export.js && node --check zip.js && node --check costumes.js
node --check props.js && node --check iconify.js && node --check urlfetch.js
for t in test/*.test.mjs; do node "$t"; done
```

Every change gets: unit tests first, then a live end-to-end check on
https://stickerify-one.vercel.app (Vercel auto-deploys on push to `main`;
GitHub Pages at https://fimtestxyz.github.io/stickerify/ is the backup).
CI runs the same checks on every push — a red run blocks the change, it
does not get "fixed later".

## Lessons already paid for

- **Test the real call shape.** A prop sort once passed its unit test and
  still shipped broken, because the test sorted bare defs while the app
  sorts `{def, rec}` wrappers. Tests must use the data shape the call site
  actually passes.
- **Measure placement from the artwork, don't assume it.** Prop anchors are
  computed from each SVG's own alpha bounding box (`measureArt`), and the
  anchor point is the feature that matters (the headphones anchor on the
  cups' midpoint, not the art's centre). OpenMoji's headphones put their
  cups at 0.40 of the art width — on the nose at any scale — so that one
  prop comes from Iconify's Carbon set (0.62) instead.
- **Draw order is a contract.** `sortPropsForDrawing` in `props.js`:
  ears → eyes → side → above → top. Headphones under glasses, hats on top.
- **Batch processing has a dispatcher.** Jobs are driven by a central
  `kick()`; nothing may assume a loop will re-run on its own after photos
  finish loading.
