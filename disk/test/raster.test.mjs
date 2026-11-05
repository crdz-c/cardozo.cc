// node --test lab/test/*.test.mjs — raster.js, which the hero and the lab share: the exact distance transform, the corner rounding
// and the blue-noise threshold map.
import test from "node:test";
import assert from "node:assert/strict";
import { distanceTransform, roundCorners, blueNoise } from "../../raster.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);

test("the distance transform is exactly Euclidean", () => {
  const n = 9;
  const mask = new Uint8Array(n * n).fill(1);
  mask[4 * n + 4] = 0; // one seed in the middle
  const d = distanceTransform(mask, n, n, 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) near(d[y * n + x], Math.hypot(x - 4, y - 4), 1e-5, `(${x}, ${y})`);
});

test("the distance transform measures to the nearest of several seeds, from either side of the mask", () => {
  const w = 12;
  const h = 7;
  const mask = new Uint8Array(w * h).fill(1);
  mask[1 * w + 1] = 0;
  mask[5 * w + 10] = 0;
  const d = distanceTransform(mask, w, h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) near(d[y * w + x], Math.min(Math.hypot(x - 1, y - 1), Math.hypot(x - 10, y - 5)), 1e-5);
  }
  const inv = distanceTransform(mask, w, h, 1); // distance to the nearest 1: zero everywhere but at the seeds
  near(inv[1 * w + 1], 1, 1e-5);
  near(inv[0], 0, 1e-9);
});

test("rounding a square's corners takes the same off each, a little more than (1 − π/4)·r², and leaves the sides alone", () => {
  const n = 80;
  const solid = new Uint8Array(n * n);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) solid[y * n + x] = 1;
  const r = 8;
  const m = roundCorners(solid, n, n, r, 0);
  assert.equal(m[20 * n + 20], 0, "the corner pixel is gone");
  assert.equal(m[40 * n + 20], 1, "the middle of a side stays");
  assert.equal(m[40 * n + 59], 1);
  assert.equal(m[40 * n + 40], 1);
  const lost = (x0, y0) => {
    let c = 0;
    for (let y = y0; y < y0 + 10; y++) for (let x = x0; x < x0 + 10; x++) if (solid[y * n + x] && !m[y * n + x]) c++;
    return c;
  };
  const corners = [lost(20, 20), lost(50, 20), lost(20, 50), lost(50, 50)];
  assert.ok(corners.every((c) => c === corners[0]), `the four corners are alike: ${corners}`);
  const ideal = (1 - Math.PI / 4) * r * r; // the continuous disc (13.7); counted on pixels it is more (23): pixel centres sit half a pixel in
  assert.ok(corners[0] >= ideal && corners[0] <= 2 * ideal, `${corners[0]} px per corner, a disc of radius ${r} takes ${ideal.toFixed(1)}`);
});

test("closing rounds the concave corners: a notch fills", () => {
  const n = 60;
  const solid = new Uint8Array(n * n);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) solid[y * n + x] = 1;
  for (let y = 10; y < 30; y++) for (let x = 30; x < 50; x++) solid[y * n + x] = 0; // an L: a notch in the upper right
  const m = roundCorners(solid, n, n, 0.5, 6);
  assert.equal(m[29 * n + 30], 1, "the inner corner is filled");
  assert.equal(m[15 * n + 40], 0, "the notch itself stays empty");
});

test("the blue-noise map: 64×64, every threshold used about equally", () => {
  const b = blueNoise();
  assert.equal(b.length, 64 * 64);
  const bins = new Array(16).fill(0);
  for (const v of b) bins[Math.min(15, v >> 4)]++;
  for (const c of bins) near(c, 256, 40, "a sixteenth of the cells in each sixteenth of the range");
});

test("the blue-noise map is blue: the lowest tenth of thresholds are spread, not clumped like white noise", () => {
  const b = blueNoise();
  const pts = [];
  for (let i = 0; i < b.length; i++) if (b[i] < 26) pts.push([i % 64, (i / 64) | 0]); // the lowest ~10 %
  assert.ok(pts.length > 300 && pts.length < 500, `~10 % of the cells (${pts.length})`);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    let nn = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = Math.min(Math.abs(pts[i][0] - pts[j][0]), 64 - Math.abs(pts[i][0] - pts[j][0])); // (the map tiles)
      const dy = Math.min(Math.abs(pts[i][1] - pts[j][1]), 64 - Math.abs(pts[i][1] - pts[j][1]));
      nn = Math.min(nn, Math.hypot(dx, dy));
    }
    sum += nn;
  }
  const meanNN = sum / pts.length;
  // measured: 2.5 for this map, 1.5 for white noise of the same density; a map that is not blue lands near the second
  assert.ok(meanNN >= 2.2, `mean nearest-neighbour distance ${meanNN.toFixed(2)}`);
});
