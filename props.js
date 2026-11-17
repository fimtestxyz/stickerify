// Live OpenMoji props for Stickerify.
// Props are NOT bundled: the app fetches each emoji SVG at runtime from the
// OpenMoji release on the jsDelivr CDN (CC-BY-SA 4.0 — attribution in
// index.html and README.md), caches it in the Cache API + memory, and draws
// it onto the sticker canvas. That keeps the app small and the list easy to
// extend: add one line to PROPS. Every code below was verified to exist on
// the CDN (HTTP 200) on 2026-11-17.
export const OPENMOJI_VERSION = "14.0.0";
export const OPENMOJI_BASE = `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@${OPENMOJI_VERSION}/color/svg`;

export function propSvgUrl(code) {
  return `${OPENMOJI_BASE}/${code}.svg`;
}

// anchor — where the prop sits on the head (head = {x, y, w, h} in canvas px):
//   top   — the art's bottom edge sits at head.y + cy*head.h (hats, crowns)
//   eyes  — the art's centre sits at (head.x + cx*head.w, head.y + cy*head.h)
//   ears  — same, spanning the head (headphones)
//   side  — same, at the side of the head (bows, flowers)
//   above — the art's centre floats above the head (light bulb)
// scale — target art width as a fraction of head width.
export const PROPS = [
  { code: "1F451", name: "Crown", char: "👑", anchor: "top", scale: 0.95 },
  { code: "1F3A9", name: "Top hat", char: "🎩", anchor: "top", scale: 0.85 },
  { code: "1F393", name: "Graduation cap", char: "🎓", anchor: "top", scale: 1.0 },
  { code: "1F9E2", name: "Cap", char: "🧢", anchor: "top", scale: 0.9, cy: 0.28 },
  { code: "1F452", name: "Hat", char: "👒", anchor: "top", scale: 1.0 },
  { code: "1FA96", name: "Helmet", char: "🪖", anchor: "top", scale: 0.95, cy: 0.3 },
  { code: "1F576", name: "Sunglasses", char: "🕶️", anchor: "eyes", scale: 0.95 },
  { code: "1F453", name: "Glasses", char: "👓", anchor: "eyes", scale: 0.9 },
  { code: "1F97D", name: "Goggles", char: "🥽", anchor: "eyes", scale: 0.95 },
  // Headphones come from Iconify's Carbon set, not OpenMoji: measured on the
  // artwork, OpenMoji's cups span only 0.40 of its width, so they land on
  // the nose; Carbon's span 0.62, so they sit on the ears. `ax`/`ay` put the
  // cups' midpoint (not the art's centre) on the ears.
  { code: "iconify:carbon:headphones", name: "Headphones", char: "🎧", anchor: "ears", scale: 1.42, cy: 0.48, ax: 0.5, ay: 0.8 },
  { code: "1F380", name: "Bow", char: "🎀", anchor: "side", scale: 0.45, cx: 0.84, cy: 0.1 },
  { code: "1F33A", name: "Flower", char: "🌺", anchor: "side", scale: 0.4, cx: 0.84, cy: 0.1 },
  { code: "1F4A1", name: "Light bulb", char: "💡", anchor: "above", scale: 0.5 },
];

/**
 * Where to draw a prop image so its artwork lands on the head.
 * `art` is the artwork's alpha bounding box in image pixels ({x, y, w, h}),
 * `imgW`/`imgH` the image size in the same units (OpenMoji: 72).
 * Returns the drawImage rect {x, y, w, h} in sticker-canvas pixels.
 * Using the art bbox (not the whole square) keeps hats sitting on the head
 * instead of floating on the SVG's transparent padding. `ax`/`ay` move the
 * anchor point inside the artwork (fractions of the art bbox, default the
 * centre — or the art's bottom edge for `top` props); the headphones use
 * them to anchor on the cups' midpoint instead of the art's centre.
 */
export function propDrawRect(prop, art, head, imgW, imgH) {
  const targetW = prop.scale * head.w;
  const s = targetW / art.w;
  const dw = imgW * s, dh = imgH * s;
  const cx = head.x + (prop.cx ?? 0.5) * head.w;
  const axFrac = prop.ax ?? 0.5;
  const ayFrac = prop.ay ?? (prop.anchor === "top" ? 1 : 0.5);
  let px, py; // where the artwork's anchor point lands, in canvas pixels
  if (prop.anchor === "top") {
    px = cx;
    py = head.y + (prop.cy ?? 0.22) * head.h;
  } else if (prop.anchor === "above") {
    px = cx;
    py = head.y - 0.1 * head.h;
  } else {
    const cyFrac = prop.cy ?? (prop.anchor === "eyes" ? 0.42 : prop.anchor === "ears" ? 0.38 : 0.14);
    px = cx;
    py = head.y + cyFrac * head.h;
  }
  return {
    x: px - (art.x + axFrac * art.w) * s,
    y: py - (art.y + ayFrac * art.h) * s,
    w: dw,
    h: dh,
  };
}

/**
 * Draw order for stacked props, so later layers sit on top of earlier ones
 * the way they would in real life: headphones under glasses, and hats and
 * crowns on top of everything (a headphone band must not cross a crown).
 * Entries are {def, rec} wrappers as built in renderSticker, or bare defs.
 */
const DRAW_ORDER = { ears: 0, eyes: 1, side: 2, above: 3, top: 4 };

export function sortPropsForDrawing(list) {
  const anchorOf = (p) => p.def?.anchor ?? p.anchor;
  return [...list].sort((a, b) => (DRAW_ORDER[anchorOf(a)] ?? 9) - (DRAW_ORDER[anchorOf(b)] ?? 9));
}

/** Fetch one prop's SVG text, via the Cache API when available. */
export async function fetchPropSvg(code, fetchImpl = globalThis.fetch) {
  const url = propSvgUrl(code);
  let cache = null;
  if (typeof caches !== "undefined") {
    try { cache = await caches.open("stickerify-props-v1"); } catch { cache = null; }
  }
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return await hit.text();
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`OpenMoji ${code}: HTTP ${res.status}`);
  if (cache) cache.put(url, res.clone()).catch(() => {});
  return await res.text();
}
