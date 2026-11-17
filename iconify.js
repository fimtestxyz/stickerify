// Live Iconify search for Stickerify props.
// Iconify (api.iconify.design) is a public, key-free API over 200+ open icon
// sets (OpenMoji, Twemoji, Noto, Fluent Emoji, Material Symbols, ...).
// Search returns icon names like "openmoji:crown"; one icon's SVG is served
// at https://api.iconify.design/<prefix>/<name>.svg. No scraping involved:
// the API exists to be queried, and every icon keeps its own open licence.
// This is the "relevant stickers, live and async" route — Flaticon's pages
// block automated fetching (HTTP 403) and its terms forbid scraping, so
// Flaticon art is only available through its official API with a key.
export const ICONIFY_BASE = "https://api.iconify.design";

export function iconifySearchUrl(query, limit = 24) {
  return `${ICONIFY_BASE}/search?query=${encodeURIComponent(query)}&limit=${limit}`;
}

export function iconifySvgUrl(icon) {
  const [prefix, ...rest] = icon.split(":");
  return `${ICONIFY_BASE}/${prefix}/${rest.join(":")}.svg`;
}

/** Human label for an icon name: "openmoji:party-popper" -> "Party Popper". */
export function iconLabel(icon) {
  const name = icon.split(":").slice(1).join(":");
  return name
    .split(/[-_ ]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Emoji-style sets first — they read as stickers; line-icon sets follow.
const EMOJI_PREFIXES = new Set([
  "openmoji", "twemoji", "noto", "noto-v1",
  "fluent-emoji", "fluent-emoji-flat", "fluent-emoji-high-contrast", "fxemoji",
]);

export function sortSearchResults(icons) {
  const rank = (icon) => (EMOJI_PREFIXES.has(icon.split(":")[0]) ? 0 : 1);
  return [...icons].sort((a, b) => rank(a) - rank(b));
}

export async function searchIconify(query, limit = 24, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(iconifySearchUrl(query, limit));
  if (!res.ok) throw new Error(`Iconify search: HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.icons) ? data.icons : [];
}

/** Fetch one icon's SVG text, via the Cache API when available. */
export async function fetchIconifySvg(icon, fetchImpl = globalThis.fetch) {
  const url = iconifySvgUrl(icon);
  let cache = null;
  if (typeof caches !== "undefined") {
    try { cache = await caches.open("stickerify-iconify-v1"); } catch { cache = null; }
  }
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return await hit.text();
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Iconify ${icon}: HTTP ${res.status}`);
  if (cache) cache.put(url, res.clone()).catch(() => {});
  return await res.text();
}
