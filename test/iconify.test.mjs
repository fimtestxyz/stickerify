// Node tests for iconify.js. URL building, labels, result sorting and the
// fetch paths (through stubs — no network). Run: node test/iconify.test.mjs
import assert from "node:assert";
import {
  iconifySearchUrl, iconifySvgUrl, iconLabel, sortSearchResults,
  searchIconify, fetchIconifySvg,
} from "../iconify.js";

assert.equal(
  iconifySearchUrl("red panda", 12),
  "https://api.iconify.design/search?query=red%20panda&limit=12",
);
assert.equal(iconifySvgUrl("openmoji:crown"), "https://api.iconify.design/openmoji/crown.svg");
assert.equal(iconifySvgUrl("mdi:crown-outline"), "https://api.iconify.design/mdi/crown-outline.svg");

assert.equal(iconLabel("openmoji:party-popper"), "Party Popper");
assert.equal(iconLabel("mdi:crown-outline"), "Crown Outline");
assert.equal(iconLabel("twemoji:1f600"), "1f600");

// Emoji-style sets sort before line-icon sets, order otherwise preserved.
assert.deepEqual(
  sortSearchResults(["mdi:crown", "openmoji:crown", "tabler:crown", "twemoji:crown"]),
  ["openmoji:crown", "twemoji:crown", "mdi:crown", "tabler:crown"],
);

// Search + fetch through stubs (no network, no Cache API in Node).
{
  const stubFetch = async (url) => {
    assert.ok(url.includes("query=dinosaur"), "search hits the right URL");
    return { ok: true, json: async () => ({ icons: ["openmoji:dinosaur", "mdi:dinosaur"] }) };
  };
  assert.deepEqual(await searchIconify("dinosaur", 24, stubFetch), ["openmoji:dinosaur", "mdi:dinosaur"]);

  const badFetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => searchIconify("dinosaur", 24, badFetch), /HTTP 429/);

  const svgFetch = async (url) => {
    assert.equal(url, iconifySvgUrl("openmoji:crown"));
    return { ok: true, text: async () => "<svg/>" };
  };
  assert.equal(await fetchIconifySvg("openmoji:crown", svgFetch), "<svg/>");
  await assert.rejects(() => fetchIconifySvg("openmoji:crown", badFetch), /HTTP 429/);
}

console.log("iconify.js: all tests passed");
