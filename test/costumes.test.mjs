// Node tests for costumes.js. Drawing runs against a stub canvas context
// (a Proxy that absorbs every method/property), which proves each costume's
// layers execute and actually draw something. Run: node test/costumes.test.mjs
import assert from "node:assert";
import { COSTUMES } from "../costumes.js";

function stubCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p === "calls") return calls;
      if (p === "canvas") return {};
      return (...args) => { calls.push(String(p)); };
    },
    set: () => true,
  });
  return ctx;
}

const HEAD = { x: 100, y: 200, w: 120, h: 140 };
const BODY = { x: 90, y: 320, w: 138, h: 182 };

assert.ok(COSTUMES.length >= 4, "at least four costumes ship");
assert.equal(new Set(COSTUMES.map((c) => c.id)).size, COSTUMES.length, "costume ids are unique");

for (const costume of COSTUMES) {
  assert.ok(costume.id && costume.name, `${costume.id} has id and name`);
  for (const layer of ["drawBack", "drawBody", "drawFront"]) {
    assert.equal(typeof costume[layer], "function", `${costume.id}.${layer} is a function`);
    const ctx = stubCtx();
    costume[layer](ctx, HEAD, BODY); // must not throw
  }
  // Back and body layers must draw something; the front layer may be empty
  // (e.g. Superhero has nothing in front of the face).
  for (const layer of ["drawBack", "drawBody"]) {
    const ctx = stubCtx();
    costume[layer](ctx, HEAD, BODY);
    assert.ok(ctx.calls.length > 0, `${costume.id}.${layer} draws something`);
  }
  // The body layer must paint filled shapes (fill) and outline them (stroke).
  const ctx = stubCtx();
  costume.drawBody(ctx, HEAD, BODY);
  assert.ok(ctx.calls.includes("fill"), `${costume.id} body fills shapes`);
  assert.ok(ctx.calls.includes("stroke"), `${costume.id} body strokes outlines`);
}

console.log("costumes.js: all tests passed");
