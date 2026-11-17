// Node tests for props.js. The placement math and the list are pure; the
// fetch goes through a stub so no network is needed.
// Run: node test/props.test.mjs
import assert from "node:assert";
import { PROPS, propSvgUrl, propDrawRect, sortPropsForDrawing, fetchPropSvg, OPENMOJI_VERSION } from "../props.js";

const ANCHORS = new Set(["top", "eyes", "ears", "side", "above"]);

// The list itself.
assert.ok(PROPS.length >= 10, "at least ten props ship");
assert.equal(new Set(PROPS.map((p) => p.code)).size, PROPS.length, "prop codes are unique");
for (const p of PROPS) {
  assert.match(p.code, /^[0-9A-F]+$/, `${p.code} is an OpenMoji codepoint`);
  assert.ok(p.name && p.char, `${p.code} has a name and an emoji char`);
  assert.ok(ANCHORS.has(p.anchor), `${p.code} anchor is known`);
  assert.ok(p.scale > 0 && p.scale <= 1.5, `${p.code} scale is sane`);
}

// The CDN URL.
assert.equal(
  propSvgUrl("1F451"),
  `https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@${OPENMOJI_VERSION}/color/svg/1F451.svg`,
);

// Placement math: art bbox {x:10, y:20, w:50, h:30} in a 72x72 image,
// head {x:100, y:200, w:120, h:140}.
const ART = { x: 10, y: 20, w: 50, h: 30 };
const HEAD = { x: 100, y: 200, w: 120, h: 140 };
const approx = (a, b) => Math.abs(a - b) < 0.01;

function artBox(rect, s) {
  // Where the artwork itself lands, given the returned drawImage rect.
  return {
    cx: rect.x + (ART.x + ART.w / 2) * s,
    bottom: rect.y + (ART.y + ART.h) * s,
    cy: rect.y + (ART.y + ART.h / 2) * s,
    w: ART.w * s,
  };
}

// Crown (top): art 0.95 head-widths wide, centred on the head, bottom edge
// 22% down the head.
{
  const prop = PROPS.find((p) => p.code === "1F451");
  const r = propDrawRect(prop, ART, HEAD, 72, 72);
  const s = (0.95 * HEAD.w) / ART.w;
  assert.ok(approx(r.w, 72 * s), "crown image width scales with the art");
  const box = artBox(r, s);
  assert.ok(approx(box.w, 0.95 * HEAD.w), "crown art is 0.95 head-widths");
  assert.ok(approx(box.cx, HEAD.x + HEAD.w / 2), "crown art is centred on the head");
  assert.ok(approx(box.bottom, HEAD.y + 0.22 * HEAD.h), "crown art bottom sits on the head");
}

// Sunglasses (eyes): art centre on the eyes, 42% down the head.
{
  const prop = PROPS.find((p) => p.code === "1F576");
  const r = propDrawRect(prop, ART, HEAD, 72, 72);
  const s = (0.95 * HEAD.w) / ART.w;
  const box = artBox(r, s);
  assert.ok(approx(box.cx, HEAD.x + HEAD.w / 2), "glasses centred on the head");
  assert.ok(approx(box.cy, HEAD.y + 0.42 * HEAD.h), "glasses sit on the eyes");
}

// Light bulb (above): art centre floats above the head.
{
  const prop = PROPS.find((p) => p.code === "1F4A1");
  const r = propDrawRect(prop, ART, HEAD, 72, 72);
  const s = (0.5 * HEAD.w) / ART.w;
  const box = artBox(r, s);
  assert.ok(box.cy < HEAD.y, "bulb floats above the head");
  assert.ok(approx(box.cx, HEAD.x + HEAD.w / 2), "bulb centred on the head");
}

// Draw order: headphones under glasses, hats and crowns on top.
{
  const crown = PROPS.find((p) => p.code === "1F451");
  const glasses = PROPS.find((p) => p.code === "1F576");
  const phones = PROPS.find((p) => p.code === "1F3A7");
  const sorted = sortPropsForDrawing([crown, glasses, phones]);
  assert.deepEqual(sorted.map((p) => p.code), ["1F3A7", "1F576", "1F451"]);
}

// Fetch through a stub (no network, no Cache API in Node).
{
  const seen = [];
  const stubFetch = async (url) => {
    seen.push(url);
    return { ok: true, text: async () => "<svg/>" };
  };
  const svg = await fetchPropSvg("1F451", stubFetch);
  assert.equal(svg, "<svg/>");
  assert.deepEqual(seen, [propSvgUrl("1F451")]);

  const badFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchPropSvg("1F451", badFetch), /HTTP 404/);
}

console.log("props.js: all tests passed");
