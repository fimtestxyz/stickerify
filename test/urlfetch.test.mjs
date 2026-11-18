// Node tests for urlfetch.js. Attempt order, proxy URLs and the fetch
// fallback chain (through stubs — no network). Run: node test/urlfetch.test.mjs
import assert from "node:assert";
import { fetchAttemptsFor, fetchImageBlob } from "../urlfetch.js";

const URL = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";

// Direct first, then the two proxies, each carrying the encoded URL.
assert.deepEqual(fetchAttemptsFor(URL), [
  URL,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(URL)}`,
  `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(URL)}`,
]);

const imageBlob = { type: "image/png" };
const okImage = () => ({ ok: true, blob: async () => imageBlob });

// Direct success: the proxies are never touched.
{
  const seen = [];
  const stub = async (u) => { seen.push(u); return okImage(); };
  const { blob, viaProxy } = await fetchImageBlob(URL, stub);
  assert.equal(blob, imageBlob);
  assert.equal(viaProxy, false);
  assert.deepEqual(seen, [URL]);
}

// Direct fetch blocked (the CORS case): the first proxy serves it.
{
  const seen = [];
  const stub = async (u) => {
    seen.push(u);
    if (u === URL) throw new TypeError("Failed to fetch");
    return okImage();
  };
  const { blob, viaProxy } = await fetchImageBlob(URL, stub);
  assert.equal(blob, imageBlob);
  assert.equal(viaProxy, true);
  assert.deepEqual(seen, [URL, fetchAttemptsFor(URL)[1]]);
}

// Direct returns a non-image (e.g. an error page): fall through to the proxy.
{
  const stub = async (u) => (u === URL
    ? { ok: true, blob: async () => ({ type: "text/html" }) }
    : okImage());
  const { viaProxy } = await fetchImageBlob(URL, stub);
  assert.equal(viaProxy, true);
}

// Everything fails: the last error surfaces.
{
  const stub = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(fetchImageBlob(URL, stub), /Failed to fetch/);
}

// An HTTP error on the direct attempt still falls through to the proxy.
{
  const stub = async (u) => (u === URL ? { ok: false, status: 404 } : okImage());
  const { viaProxy } = await fetchImageBlob(URL, stub);
  assert.equal(viaProxy, true);
}

console.log("urlfetch tests passed");
