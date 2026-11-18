// Fetching photos from arbitrary URLs. A direct cross-origin fetch only
// works when the host sends an Access-Control-Allow-Origin header; most
// image hosts do not, and the browser then blocks the read entirely
// ("No 'Access-Control-Allow-Origin' header is present on the requested
// resource"). So: try the URL directly first, then retry through public
// CORS proxies that re-fetch the same public URL server-side and return it
// with CORS headers. Only the pasted public URL goes to a proxy — photos
// uploaded from the device never leave it.

const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

/** Ordered fetch attempts for an image URL: direct first, proxies after. */
export function fetchAttemptsFor(url) {
  return [url, ...CORS_PROXIES.map((proxy) => proxy(url))];
}

async function fetchWithTimeout(fetchFn, url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch an image blob from a URL, direct first then CORS proxies.
 * Returns { blob, viaProxy } — viaProxy is true when a proxy served it.
 * Throws the last error when every attempt fails.
 */
export async function fetchImageBlob(url, fetchFn = fetch, timeoutMs = 20000) {
  const attempts = fetchAttemptsFor(url);
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const res = await fetchWithTimeout(fetchFn, attempts[i], timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("not an image");
      return { blob, viaProxy: i > 0 };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("fetch failed");
}
