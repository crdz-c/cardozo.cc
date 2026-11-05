// cardozo.cc/lab/math.js — the lab's pure logic, with no DOM and no WebGL, so it can be tested under node (lab/test/*.test.mjs).
// engine.js and models/text.js import from here.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v) => clamp(v, 0, 1);

// ------------------------------------------------------------------ the build
// How fast dots land (Lucas's sketch, the same as hero.js's BUILD_RATE): [from t, to t, from v, to v, shape], shape 0 linear,
// k > 0 a decay fast first then flat, -1 an abrupt jump. The fill is the integral, normalised so it ends exactly at 1.
export const BUILD_RATE = [
  [0, 0.207, 0, 1, 0],
  [0.207, 0.32, 1, 0.19, 3],
  [0.32, 0.387, 0.19, 0.47, 0],
  [0.387, 0.563, 0.47, 0.22, 2.5],
  [0.563, 0.573, 0.22, 0.95, -1],
  [0.573, 0.766, 0.95, 0.33, 2.5],
  [0.766, 0.777, 0.33, 0.95, -1],
  [0.777, 0.992, 0.95, 0.51, 0.6],
  [0.992, 1, 0.51, 0.51, 0],
];
export function buildRate(t) {
  for (const [t0, t1, v0, v1, k] of BUILD_RATE) {
    if (t > t1) continue;
    const u = clamp01((t - t0) / (t1 - t0));
    const f = k === -1 ? u * u * (3 - 2 * u) : k > 0 ? (1 - Math.exp(-k * u)) / (1 - Math.exp(-k)) : u;
    return v0 + (v1 - v0) * f;
  }
  return 0;
}
const BUILD_TABLE = (() => {
  const n = 2048;
  const tab = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) tab[i] = tab[i - 1] + buildRate((i - 0.5) / n) / n;
  for (let i = 0; i <= n; i++) tab[i] /= tab[n];
  return tab;
})();
// the share (0 … 1) that has landed at moment t (0 … 1) of a build…
export function buildProgress(t) {
  const n = BUILD_TABLE.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return BUILD_TABLE[i] + (BUILD_TABLE[i + 1] - BUILD_TABLE[i]) * (x - i);
}
// …and the moment by which a share p has landed (the inverse: a site of rank p lands then)
export function buildInverse(p) {
  const n = BUILD_TABLE.length - 1;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (BUILD_TABLE[mid] < p) lo = mid;
    else hi = mid;
  }
  const span = BUILD_TABLE[hi] - BUILD_TABLE[lo] || 1;
  return (lo + clamp01((p - BUILD_TABLE[lo]) / span)) / n;
}

// ------------------------------------------------------------------ quaternions [x, y, z, w] and 3×3 matrices (row-major arrays of 9)
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qnorm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  return a.map((v) => v / l);
};
export const qaxis = (x, y, z, ang) => {
  const l = Math.hypot(x, y, z) || 1;
  const s = Math.sin(ang / 2) / l;
  return [x * s, y * s, z * s, Math.cos(ang / 2)];
};
export function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1; // (the short way round)
  d = Math.abs(d);
  const bb = b.map((v) => v * s);
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(d);
  const sn = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / sn;
  const wb = Math.sin(t * th) / sn;
  return a.map((v, i) => v * wa + bb[i] * wb);
}
// the angle (rad) between two orientations
export const qangle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
export const qmat = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
export const mmul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
export const toGL = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]); // R, column-major
export const toGLT = (m) => new Float32Array(m); // R's transpose, column-major, is R row-major
// a column-major 3×3 times a vector, as GLSL's `M * v` does it (for the tests of toGL / toGLT)
export const glMulVec = (m, [x, y, z]) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];

// ------------------------------------------------------------------ the camera
export const FOCAL = 2; // the camera's focal length, in units of the screen's shorter side (a disc's radius is 1)

// Where the camera stands at home for a card or disc (`plate` has the half extents ax, ay: the longer is 1): the plate, a disc's
// diameter or a card's longer side, takes `size` of the screen (W × H CSS px). fit "cover" makes it fill the screen instead.
export function plateDistance(plate, W, H, size, fit = "contain") {
  const m = Math.min(W, H);
  const a = plate.ax / W;
  const b = plate.ay / H;
  return fit === "cover" ? 2 * FOCAL * m * Math.min(a, b) : (2 * FOCAL * m * Math.max(a, b)) / size;
}

// Pixel art on a sheet (gridW × gridH pixels, half extents ax, ay) on a field of `cells` (w, h): a pixel is a whole number of cells
// (`px` of them, or as many as fit `size` of the screen), the sheet's edge on a cell boundary. Returns the camera's distance
// (the sheet is `thick` thick: its front face is that much nearer than its centre), the shift of its centre in cells that puts
// the left and bottom edges on whole cells, and px.
export function pixelLayout(cells, grid, ax, size, px = 0, thick = 1e-4) {
  const n = px > 0 ? Math.floor(px) : Math.max(1, Math.min(Math.floor((size * cells[0]) / grid.w), Math.floor((size * cells[1]) / grid.h)));
  const m = Math.min(cells[0], cells[1]);
  const left = cells[0] / 2 - (grid.w * n) / 2;
  const bottom = cells[1] / 2 - (grid.h * n) / 2;
  return { dist: (2 * FOCAL * ax * m) / (grid.w * n) + thick, off: [Math.round(left) - left, Math.round(bottom) - bottom], px: n };
}

// ------------------------------------------------------------------ pixel text: when each pixel lands
// o = { word, gap, fill, flash, loop } in seconds. A word starts every (word + gap) s; inside it a pixel lands when the build
// curve has reached its rank (`inv` = buildInverse(rank), 0 … 1); then it fills in over `fill` s and flashes for ~`flash` s.
export const landTime = (wordIndex, inv, o) => wordIndex * (o.word + o.gap) + inv * o.word;
export function pixelState(t, landT, o) {
  const dt = t - landT; // seconds since it landed
  return dt <= 0 ? [0, 0] : [Math.min(1, dt / o.fill), Math.exp(-dt / o.flash)];
}
export const textDuration = (nWords, o) => (nWords - 1) * (o.word + o.gap) + o.word + o.fill + 3 * o.flash;
// the time inside the animation: it runs once, or (loop > 0) repeats after `loop` s of rest
export const textTime = (t, nWords, o) => (o.loop > 0 ? t % (textDuration(nWords, o) + o.loop) : t);
