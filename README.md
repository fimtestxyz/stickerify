# 🪄 Stickerify

[![CI](https://github.com/fimtestxyz/stickerify/actions/workflows/ci.yml/badge.svg)](https://github.com/fimtestxyz/stickerify/actions/workflows/ci.yml)

Upload a photo of people — especially toddlers and kids — and Stickerify cuts out
every head (or the whole person, if you pick Full body) and turns it into a
sticker: thick outline, soft shadow, transparent background, ready to download
as PNG or as a sticker sheet.

## Privacy first

**Your photos never leave your device.** Segmentation runs entirely in your
browser with an on-device MediaPipe ML model. There is no server, no upload, no
account, and no storage — close the tab and the photo is gone. This matters
most for photos of children: nothing about them is ever sent anywhere.

The tool does not identify anyone. It only finds head and body shapes (hair +
face, or body-skin + clothes) and cuts them out.

## How it works

1. **Segment.** A MediaPipe multiclass selfie-segmentation model classifies each
   pixel (background / hair / body-skin / face-skin / clothes / other). Head
   pixels are hair + face-skin. Each separate head blob becomes its own sticker.
   In **Full body** mode, nearby body blobs (torso, arms, legs) are grouped
   with their head into one whole-person sticker; body blobs far from any head
   become their own sticker.
2. **Cut out.** Heads are cut from the original photo with a soft, feathered edge.
3. **Stickerify.** A dilated silhouette in your chosen outline colour, an optional
   drop shadow, and an optional background disc turn each cut-out into a sticker.

If the multiclass model cannot load, the app falls back to the binary selfie
segmenter plus BlazeFace face detection (person mask ∩ expanded face box).

> Note: on iOS Safari the GPU delegate can scramble multiclass categories, so
> the app uses the CPU delegate throughout.

## Run it

No build step, no install. Serve the folder over HTTP (browsers block ES modules
from `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or deploy the folder as-is to GitHub Pages / Netlify / any static host.

## Use

- Drop in one or many photos, paste them, click **Choose photos**, or load
  from URLs (one per line).
- Choose **Head only** or **Full body** (head, torso, arms and legs) — switching
  re-cuts finished photos instantly, no re-segmentation needed.
- The segmentation model downloads once (~16 MB) with a live progress bar,
  then stays cached in the browser — repeat visits start instantly.
- Photos are processed in parallel — up to three at a time in background
  workers, each with its own status. (If workers are unavailable, the app
  falls back to processing one by one on the main thread.)
- Pick which heads to keep, tune outline width / colour / background / shadow.
- Dress up heads with a costume (Superhero, Astronaut, Bunny, Dino) — the head
  is pasted onto a cute cartoon body drawn on-device, sharing one outline.
  Costumes apply to Head only stickers.
- Add live props from OpenMoji (crown, hats, sunglasses, headphones, bow,
  flower, light bulb…) — tap one in the Props row and it is fetched from the
  OpenMoji release on the jsDelivr CDN, cached, and drawn onto every head.
  Several props can be on at once; they stack with costumes, and they travel
  into the Telegram export too. Props apply to Head only stickers.
- Search for more stickers live: type a word in the Props search box and it
  queries the Iconify API (200+ open icon sets, no key, no scraping) and
  shows matching SVGs — pick a placement (on top / eyes / ears / side /
  above) and tap one to add it to the Props row. Added stickers behave like
  the built-ins: they stack, follow the head, and export to Telegram.
- Download individual stickers as PNG, or all of them at once as a sticker sheet.
- **Segment objects** ([segment.html](segment.html)): one photo, many objects.
  A DeepLabV3 model removes the background and cuts out every recognised
  object (people, dogs, cats, cars, bottles, chairs — 21 kinds in all).
  Tap to select the ones you want, then download them as a ZIP of PNGs or
  as a Telegram pack. Same privacy rule: the photo never leaves the device.
- **Export Telegram pack**: one click builds a ZIP of Telegram-compliant
  stickers (512 px on the long side, WebP or PNG, under 512 KB each, plus a
  100×100 pack icon) and shows the steps to publish it with Telegram's
  official @Stickers bot (`/newpack` → send files as documents → one emoji
  per sticker → `/publish`).

## Files

| File | What it is |
| --- | --- |
| `index.html` | Upload UI, controls, job list |
| `segment.html` | Segment-objects page: one photo, background-removed preview, object grid, bulk download |
| `segment.js` | Segment-objects UI: DeepLabV3 worker, cut-outs, selection, ZIP + Telegram export |
| `styles.css` | Styling |
| `app.js` | Model download with progress, job queue, worker pool, sticker rendering, UI |
| `worker.js` | Segmentation worker (one per concurrent photo) |
| `segmentation.js` | DOM-free mask helpers (connected components, dilation, upscaling) — unit-testable in Node |
| `telegram-export.js` | Telegram pack export (512 px WebP/PNG encode, size ladder, pack icon) |
| `zip.js` | Dependency-free ZIP writer (STORE) for the Telegram pack |
| `costumes.js` | Cartoon body costumes (vector-drawn, no image assets) |
| `props.js` | Live OpenMoji props: list, head placement math, CDN fetch + cache |
| `iconify.js` | Live Iconify search: keyword search + SVG fetch over 200+ open sets |

## Models (loaded at runtime from Google's CDN)

- Multiclass selfie segmentation (256×256, float32, Apache-2.0):
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`
- DeepLabV3 general object segmentation (float32, Apache-2.0, ~2.7 MB):
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite`
- Fallback binary selfie segmenter (float16, Apache-2.0) and BlazeFace
  short-range face detector (float16, Apache-2.0)
- Runtime: `@mediapipe/tasks-vision@0.10.14` via jsDelivr

## Tests

```bash
node --check app.js && node --check segment.js && node --check worker.js && node --check segmentation.js
node --check telegram-export.js && node --check zip.js && node --check costumes.js
node --check props.js
node test/segmentation.test.mjs
node test/zip.test.mjs
node test/telegram-export.test.mjs
node test/costumes.test.mjs
node test/props.test.mjs
node test/iconify.test.mjs
```

Props use [OpenMoji](https://openmoji.org) emoji, licensed CC-BY-SA 4.0, fetched
live from the jsDelivr CDN (see `props.js`). To add a prop, add one line to
`PROPS` in `props.js` with the emoji's codepoint, name, character, anchor
(`top` / `eyes` / `ears` / `side` / `above`) and scale — no other code changes
needed. One exception: Headphones come from Iconify's Carbon set, because
OpenMoji's headphone artwork has its cups too close together (0.40 of its
width) to sit on real ears — Carbon's span 0.62. Prop placement is measured
from each artwork's own alpha bounds (see `measureArt` in `app.js`), and
`ax`/`ay` in a prop entry move the anchor point inside the artwork when the
feature that matters (the cups) is not at its centre.

Search results come from the [Iconify API](https://iconify.design) (see
`iconify.js`); each icon keeps its own open licence. Flaticon is deliberately
not scraped: its pages block automated fetching and its terms forbid it — its
art is available through Flaticon's official API with an API key instead.

## License

MIT. MediaPipe models and runtime are Apache-2.0 (Google).
