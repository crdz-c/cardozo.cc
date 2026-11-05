// node --test lab/test/*.test.mjs — the lab's pure logic (lab/math.js): the build curve, the rotations, the camera and pixel layout,
// the timing of the pixel text.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProgress, buildInverse, buildRate, BUILD_RATE, qmul, qnorm, qaxis, qslerp, qmat, qangle, mmul, toGL, toGLT, glMulVec,
  FOCAL, plateDistance, pixelLayout, landTime, pixelState, textDuration, textTime,
} from "../math.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);
const mulVec = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })(); // a seeded random

// ------------------------------------------------------------------ the build curve
test("the build fill runs 0 → 1 and never goes back", () => {
  assert.equal(buildProgress(0), 0);
  near(buildProgress(1), 1, 1e-6);
  let prev = 0;
  for (let i = 0; i <= 4000; i++) {
    const p = buildProgress(i / 4000);
    assert.ok(p >= prev - 1e-9, `fell at ${i / 4000}`);
    prev = p;
  }
});

test("the build fill matches the hero's table (README: fill at the end of each segment)", () => {
  const table = [[0.207, 0.209], [0.32, 0.304], [0.387, 0.349], [0.563, 0.455], [0.573, 0.466], [0.766, 0.67], [0.777, 0.684], [0.992, 0.992], [1, 1]];
  for (const [t, fill] of table) near(buildProgress(t), fill, 0.003, `fill at ${t}`);
});

test("the build rate hits its sketch: bursts at the segment ends, the crash in between", () => {
  for (const [t0, , v0] of BUILD_RATE) near(buildRate(t0 + 1e-9), v0, 1e-3, `rate at ${t0}`);
  near(buildRate(0.207), 1, 1e-3);
  near(buildRate(0.32), 0.19, 1e-3);
  assert.ok(buildRate(0.57) > buildRate(0.55) * 2, "the abrupt jump at 56–57 %");
});

test("the inverse of the build fill is its inverse", () => {
  for (let i = 1; i < 200; i++) {
    const p = i / 200;
    near(buildProgress(buildInverse(p)), p, 1e-3, `progress(inverse(${p}))`);
  }
  for (let t = 0.05; t <= 1; t += 0.05) near(buildInverse(buildProgress(t)), t, 3e-3, `inverse(progress(${t}))`);
  near(buildInverse(0), 0, 1e-3);
  near(buildInverse(1), 1, 1e-3);
});

// ------------------------------------------------------------------ rotations
test("dragging right (a turn about +y) moves the near side to the right; dragging down (about +x), down", () => {
  const th = 0.4;
  const [x, y, z] = mulVec(qmat(qaxis(0, 1, 0, th)), [0, 0, 1]);
  near(x, Math.sin(th), 1e-9);
  near(y, 0, 1e-9);
  near(z, Math.cos(th), 1e-9);
  const [x2, y2, z2] = mulVec(qmat(qaxis(1, 0, 0, th)), [0, 0, 1]);
  near(x2, 0, 1e-9);
  near(y2, -Math.sin(th), 1e-9); // (screen y is up: the near side goes down)
  near(z2, Math.cos(th), 1e-9);
});

test("quaternion matrices are rotations, and compose like the quaternions", () => {
  for (let k = 0; k < 20; k++) {
    const q = qnorm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    const R = qmat(q);
    const RRt = mmul(R, [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]);
    RRt.forEach((v, i) => near(v, i % 4 === 0 ? 1 : 0, 1e-9, "R·Rᵀ = I"));
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    near(det, 1, 1e-9, "det = 1");
  }
  const a = qaxis(0, 1, 0, 0.7);
  const b = qaxis(1, 0, 0, -0.3);
  const v = [0.3, -0.2, 0.9];
  mulVec(qmat(qmul(b, a)), v).forEach((c, i) => near(c, mulVec(mmul(qmat(b), qmat(a)), v)[i], 1e-9, "qmat(b·a) = qmat(b)·qmat(a)"));
});

test("slerp: the ends, the middle, and the short way round", () => {
  const a = qaxis(0, 1, 0, 0);
  const b = qaxis(0, 1, 0, 1.2);
  near(qangle(qslerp(a, b, 0), a), 0, 1e-9);
  near(qangle(qslerp(a, b, 1), b), 0, 1e-9);
  near(qangle(qslerp(a, b, 0.5), a), 0.6, 1e-9, "half the angle");
  const neg = b.map((v) => -v); // the same rotation
  near(qangle(qslerp(a, neg, 0.5), a), 0.6, 1e-9, "q and −q are one rotation: no long way round");
  near(qangle(a, b), 1.2, 1e-9);
});

test("the matrices sent to GLSL are R and Rᵀ (column-major)", () => {
  const R = mmul(qmat(qaxis(0, 1, 0, 0.5)), qmat(qaxis(1, 0, 0, 1.1)));
  const v = [0.2, 0.5, -0.7];
  const Rv = mulVec(R, v);
  const Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
  const Rtv = mulVec(Rt, v);
  glMulVec(toGL(R), v).forEach((c, i) => near(c, Rv[i], 1e-6, "uM · v = R v"));
  glMulVec(toGLT(R), v).forEach((c, i) => near(c, Rtv[i], 1e-6, "uMt · v = Rᵀ v"));
});

// ------------------------------------------------------------------ the camera
// the share of the screen a plate takes at home: projected width = 2·F·ax / dist, in units of the shorter side
const share = (plate, W, H, dist) => ({ w: (2 * FOCAL * plate.ax) / dist * Math.min(W, H) / W, h: (2 * FOCAL * plate.ay) / dist * Math.min(W, H) / H });

test("at home a disc's diameter is `size` of the shorter side, in any window", () => {
  for (const [W, H] of [[800, 800], [1440, 900], [390, 844], [2000, 500]]) {
    const s = share({ ax: 1, ay: 1 }, W, H, plateDistance({ ax: 1, ay: 1 }, W, H, 0.8));
    // (s.w and s.h are fractions of W and of H: the disc spans `size` of the SHORTER side, so the larger fraction is `size`)
    near(Math.max(s.w, s.h), 0.8, 1e-9, `${W}×${H}: the shorter side`);
    assert.ok(s.w <= 0.8 + 1e-9 && s.h <= 0.8 + 1e-9, "inside the screen's share");
  }
});

test("a wide card fits `size` of the screen in the tighter direction; `cover` fills it", () => {
  const card = { ax: 1, ay: 0.5625 };
  for (const [W, H] of [[1200, 600], [600, 1200], [1000, 1000]]) {
    const c = share(card, W, H, plateDistance(card, W, H, 0.8, "contain"));
    assert.ok(c.w <= 0.8 + 1e-9 && c.h <= 0.8 + 1e-9, `${W}×${H}: contain stays inside`);
    near(Math.max(c.w, c.h), 0.8, 1e-9, "…and touches it in one direction");
    const v = share(card, W, H, plateDistance(card, W, H, 0.8, "cover"));
    assert.ok(v.w >= 1 - 1e-9 && v.h >= 1 - 1e-9, `${W}×${H}: cover covers`);
    near(Math.min(v.w, v.h), 1, 1e-9, "…exactly in one direction");
  }
});

test("pixel layout: a font pixel is a whole number of cells and the sheet's edges fall on cell boundaries", () => {
  for (let k = 0; k < 400; k++) {
    const cells = [Math.floor(200 + rnd() * 1800), Math.floor(150 + rnd() * 1200)];
    const grid = { w: Math.floor(40 + rnd() * 200), h: Math.floor(20 + rnd() * 120) };
    const asp = grid.w / grid.h;
    const ax = asp >= 1 ? 1 : asp;
    const L = pixelLayout(cells, grid, ax, 0.8);
    assert.ok(Number.isInteger(L.px) && L.px >= 1, "px is a whole number ≥ 1");
    assert.ok(Math.abs(L.off[0]) <= 0.5 + 1e-9 && Math.abs(L.off[1]) <= 0.5 + 1e-9, "the shift is under half a cell");
    for (const [edge, off] of [[cells[0] / 2 - (grid.w * L.px) / 2, L.off[0]], [cells[1] / 2 - (grid.h * L.px) / 2, L.off[1]]]) near((edge + off) % 1, 0, 1e-9, "an edge on a whole cell") || 0;
    if (L.px > 1) assert.ok(grid.w * L.px <= 0.8 * cells[0] + 1e-9 && grid.h * L.px <= 0.8 * cells[1] + 1e-9, "it fits `size`");
    // the camera puts the sheet's front face exactly grid.w·px cells wide
    const m = Math.min(...cells);
    near(((2 * FOCAL * ax) / (L.dist - 1e-4)) * m, grid.w * L.px, 1e-6, "projected width in cells");
  }
});

test("pixel layout: ?px= is taken as given, and is at least one cell", () => {
  const L = pixelLayout([800, 600], { w: 100, h: 50 }, 1, 0.8, 6.9);
  assert.equal(L.px, 6);
  assert.equal(pixelLayout([30, 20], { w: 500, h: 200 }, 1, 0.8).px, 1, "a screen too small still gets one cell per pixel");
});

// ------------------------------------------------------------------ pixel text timing
const O = { word: 1.1, gap: 0.3, fill: 0.3, flash: 0.2, loop: 0 };

test("a pixel lands inside its word's window", () => {
  for (let w = 0; w < 4; w++) {
    for (let i = 0; i <= 20; i++) {
      const t = landTime(w, i / 20, O);
      assert.ok(t >= w * (O.word + O.gap) - 1e-9 && t <= w * (O.word + O.gap) + O.word + 1e-9);
    }
  }
});

test("a pixel's fill and flash: nothing before it lands, full after `fill`, the flash decays", () => {
  assert.deepEqual(pixelState(0.5, 1, O), [0, 0]);
  assert.deepEqual(pixelState(1, 1, O), [0, 0]);
  near(pixelState(1.15, 1, O)[0], 0.5, 1e-9);
  near(pixelState(1.3, 1, O)[0], 1, 1e-9);
  near(pixelState(9, 1, O)[0], 1, 1e-9);
  near(pixelState(1.2, 1, O)[1], Math.exp(-1), 1e-9);
  assert.ok(pixelState(1.5, 1, O)[1] < pixelState(1.2, 1, O)[1]);
});

test("with the default timing a word is complete before the next one begins", () => {
  // every pixel of word 0 and word 1 at random ranks: whenever any pixel of word 1 has begun, all of word 0 is full
  const rank = () => buildInverse(rnd());
  const w0 = Array.from({ length: 300 }, () => landTime(0, rank(), O));
  w0.push(landTime(0, 1, O)); // (the very last one)
  const w1 = Array.from({ length: 300 }, () => landTime(1, rank(), O));
  w1.push(landTime(1, 0, O));
  for (let t = 0; t <= 4; t += 0.002) {
    const started = w1.some((l) => pixelState(t, l, O)[0] > 0);
    if (started) assert.ok(w0.every((l) => pixelState(t, l, O)[0] === 1), `word 0 still filling at ${t}`);
  }
});

test("the text's duration and its loop", () => {
  near(textDuration(2, O), 1.1 + 0.3 + 1.1 + 0.3 + 0.6, 1e-9);
  assert.equal(textTime(7, 2, O), 7, "plays once");
  const L = { ...O, loop: 2 };
  const total = textDuration(2, L);
  near(textTime(total + 2 + 0.5, 2, L), 0.5, 1e-9, "wraps after the rest");
  near(textTime(1, 2, L), 1, 1e-9);
});
