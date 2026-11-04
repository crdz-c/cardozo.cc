// cardozo.cc hero — the CRDZC wordmark as a dithered, pointer-lit object (WebGL), plus the boot
// sequence. No dependencies. Everything degrades: without WebGL the inline SVG wordmark stays; with
// prefers-reduced-motion it renders one still frame and skips the boot.

const html = document.documentElement;
const hero = document.getElementById("hero");
const canvas = hero.querySelector(".scene");
const logoSvg = hero.querySelector(".logo svg");

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(hover: none)").matches;

const INK = [6 / 255, 6 / 255, 6 / 255];
const PAPER = [240 / 255, 239 / 255, 234 / 255];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : the field fills in and the letters dissolve into view
  hover: 0, // 0 → 1 while someone is steering the light
  light: [0, 0], // light position, CSS px in the hero (spring-driven)
  lightVel: [0, 0], // CSS px / s
  target: [0, 0],
  lastPointer: -1e9,
  inside: false,
  time: reduce ? 6 : 0,
  logoCss: [0, 0, 1, 1], // left, top, w, h of the wordmark in CSS px (viewport)
};

// ------------------------------------------------------------------ per-letter flips
// Every letter starts in a random orientation (flipped horizontally and/or vertically, or not at all).
// After that a letter only changes when the pointer touches it (or on a tap): it flips around its own
// centre, horizontally or vertically at random. The flip itself runs in the shader (scale through zero).
const LETTERS = 5;
const LETTER_EDGES = [-1, 18.55 / 90, 36.15 / 90, 54.75 / 90, 71.15 / 90, 2]; // gap midpoints, in u
// C and D look identical flipped vertically, so they lean horizontal; R and Z are fair game
const HORIZONTAL_BIAS = [0.8, 0.5, 0.8, 0.5, 0.8];
const flipUniform = new Float32Array(LETTERS * 2).fill(1);
const flips = Array.from({ length: LETTERS }, () => ({
  mx: Math.random() < 0.5 ? 1 : -1, // random starting orientation, every load
  my: Math.random() < 0.5 ? 1 : -1,
  axis: "x",
  flipping: false,
  t0: 0,
  dur: 0,
}));
const letterGroups = [...logoSvg.querySelectorAll(".lt")];
let flipsArmed = false;
const rand = (a, b) => a + Math.random() * (b - a);

flips.forEach((f, i) => {
  flipUniform[i * 2] = f.mx;
  flipUniform[i * 2 + 1] = f.my;
});

// no-WebGL fallback: the SVG letters follow the same state
function flipSvg() {
  letterGroups.forEach((g, i) => {
    g.style.transform = `scale(${flipUniform[i * 2] || 0.001}, ${flipUniform[i * 2 + 1] || 0.001})`;
  });
}

function startFlip(i, now) {
  const f = flips[i];
  if (f.flipping) return;
  f.axis = Math.random() < HORIZONTAL_BIAS[i] ? "x" : "y";
  f.flipping = true;
  f.t0 = now;
  f.dur = rand(760, 980);
}

function updateFlips(now) {
  flips.forEach((f, i) => {
    let sx = f.mx;
    let sy = f.my;
    if (f.flipping) {
      const t = clamp01((now - f.t0) / f.dur);
      // quart in-out: the letter leaves slowly, passes edge-on quickly, and settles softly; it never
      // grows past its size or leaves its place
      const c = Math.cos(Math.PI * easeInOutQuart(t));
      if (f.axis === "x") sx = f.mx * c;
      else sy = f.my * c;
      if (t >= 1) {
        if (f.axis === "x") f.mx *= -1;
        else f.my *= -1;
        sx = f.mx;
        sy = f.my;
        f.flipping = false;
      }
    }
    flipUniform[i * 2] = sx;
    flipUniform[i * 2 + 1] = sy;
  });
  if (!scene) flipSvg();
}

function measureLogo() {
  const r = logoSvg.getBoundingClientRect();
  state.logoCss = [r.left, r.top, r.width, r.height];
}

function letterAt(clientX, clientY) {
  const [l, t, w, h] = state.logoCss;
  const u = (clientX - l) / w;
  const v = (clientY - t) / h;
  if (u < 0 || u > 1 || v < -0.35 || v > 1.35) return -1;
  for (let i = 0; i < LETTERS; i++) if (u >= LETTER_EDGES[i] && u < LETTER_EDGES[i + 1]) return i;
  return -1;
}

let overLetter = -1;
function pointerLetter(e, force) {
  if (!flipsArmed) return;
  const i = letterAt(e.clientX, e.clientY);
  const entered = i !== overLetter;
  overLetter = i;
  if (i < 0 || !(entered || force)) return;
  startFlip(i, performance.now());
}

// ------------------------------------------------------------------ wordmark texture
// The SVG paths are rasterised once; from that we derive, per texel:
//   R coverage · G distance to the edge inside a letter · B closeness to a letter outside it.
// G and B together give the shader a signed distance to the edge, used for a soft dithered edge.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const MARGIN = 110; // transparent border (texels) so the outer field fits and sampling past the edge reads 0
const DEPTH = 55; // texels: range of the inside distance
const HALO = 90; // texels: range of the outside distance
const ROUND_OPEN = 17; // texels (≈ 4.9% of the letter height, 346 texels): radius of the outer corners
const ROUND_CLOSE = 9; // texels (≈ 2.6%): radius of the inner corners

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance in texels from every texel
// to the nearest texel where mask === seed (0 there). Exact circles matter: the corner rounding below is
// an opening/closing by a disc, and a chamfer metric would round corners into octagons.
function distanceTransform(mask, w, h, seed) {
  const INF = 1e20;
  const n = w * h;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = mask[i] === seed ? 0 : INF;
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const out = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  const pass = (count) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < count; q++) {
      let sx = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (sx <= z[k]) {
        k--;
        sx = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = sx;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = d[row + x];
    pass(w);
    for (let x = 0; x < w; x++) d[row + x] = out[x];
  }
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.sqrt(d[i]);
  return r;
}

// Round every corner of a binary mask: an opening by a disc of radius rOpen rounds the convex corners
// (Z's points, the C terminals, R's leg), a closing by rClose rounds the concave ones (R's notch, the
// inside corners of D and Z). Stroke widths and counters wider than the discs are left as they are.
function roundCorners(solid, w, h, rOpen, rClose) {
  const n = w * h;
  let m = new Uint8Array(n);
  let dIn = distanceTransform(solid, w, h, 0);
  for (let i = 0; i < n; i++) m[i] = dIn[i] > rOpen ? 1 : 0; // erode
  let dOut = distanceTransform(m, w, h, 1);
  for (let i = 0; i < n; i++) m[i] = dOut[i] <= rOpen ? 1 : 0; // dilate → opened
  dOut = distanceTransform(m, w, h, 1);
  for (let i = 0; i < n; i++) m[i] = dOut[i] <= rClose ? 1 : 0; // dilate
  dIn = distanceTransform(m, w, h, 0);
  for (let i = 0; i < n; i++) m[i] = dIn[i] > rClose ? 1 : 0; // erode → closed
  return m;
}

function buildWordmarkTexture() {
  const cw = Math.round(VBW * TEXELS_PER_UNIT);
  const ch = Math.round(VBH * TEXELS_PER_UNIT);
  const tw = cw + MARGIN * 2;
  const th = ch + MARGIN * 2;

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, tw, th);
  ctx.translate(MARGIN, MARGIN);
  ctx.scale(TEXELS_PER_UNIT, TEXELS_PER_UNIT);
  ctx.fillStyle = "#fff";
  logoSvg.querySelectorAll("path").forEach((p) => ctx.fill(new Path2D(p.getAttribute("d"))));

  const rgba = ctx.getImageData(0, 0, tw, th).data;
  const n = tw * th;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = rgba[i * 4] > 127 ? 1 : 0;
  const solid = roundCorners(raw, tw, th, ROUND_OPEN, ROUND_CLOSE);

  const inside = distanceTransform(solid, tw, th, 0); // letter texels: distance to the nearest outside texel
  const outside = distanceTransform(solid, tw, th, 1); // outside texels: distance to the nearest letter texel

  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = solid[i] * 255;
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / DEPTH) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / HALO) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, tw, th, cw, ch };
}

// ------------------------------------------------------------------ blue noise
// A 64×64 threshold map made at load with void-and-cluster (Ulichney): every threshold rank goes to the
// emptiest spot left, so lit cells spread evenly at any density, with no lattice and no diagonal
// streaks. ~4k × 4k cheap updates: a few tens of milliseconds, once.
function blueNoise(N = 64, sigma = 1.6) {
  const n = N * N;
  const kernel = new Float32Array(n); // toroidal gaussian, indexed by (dy * N + dx)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - x);
      const dy = Math.min(y, N - y);
      kernel[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  const energy = new Float32Array(n);
  const on = new Uint8Array(n);
  const splat = (i, sign) => {
    const px = i % N;
    const py = (i / N) | 0;
    for (let y = 0; y < N; y++) {
      const ky = ((y - py + N) % N) * N;
      const row = y * N;
      for (let x = 0; x < N; x++) energy[row + x] += sign * kernel[ky + ((x - px + N) % N)];
    }
  };
  const extreme = (wantOn, max) => {
    let best = -1;
    let bv = max ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if (on[i] !== wantOn) continue;
      const v = energy[i];
      if (max ? v > bv : v < bv) {
        bv = v;
        best = i;
      }
    }
    return best;
  };

  // initial pattern: ~10% random seeds, relaxed by moving the tightest cluster into the largest void
  const seeds = Math.round(n * 0.1);
  for (let k = 0; k < seeds; ) {
    const i = (Math.random() * n) | 0;
    if (!on[i]) {
      on[i] = 1;
      splat(i, 1);
      k++;
    }
  }
  for (let guard = 0; guard < n; guard++) {
    const c = extreme(1, true);
    on[c] = 0;
    splat(c, -1);
    const v = extreme(0, false);
    on[v] = 1;
    splat(v, 1);
    if (v === c) break;
  }

  const rank = new Uint16Array(n);
  // phase 1: peel the seeds off, tightest cluster first
  const saveOn = on.slice();
  const saveE = energy.slice();
  for (let r = seeds - 1; r >= 0; r--) {
    const c = extreme(1, true);
    on[c] = 0;
    splat(c, -1);
    rank[c] = r;
  }
  on.set(saveOn);
  energy.set(saveE);
  // phase 2: fill the largest voids until every cell has a rank
  for (let r = seeds; r < n; r++) {
    const v = extreme(0, false);
    on[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(((rank[i] + 0.5) / n) * 255);
  return out;
}

// ------------------------------------------------------------------ shader
// The canvas runs at one texel per dither cell and is upscaled by an integer factor with
// image-rendering: pixelated, so every cell is a crisp square of exactly CELL device pixels.
//
// Density, not cell size, carries the gradient: the screen is a quadtree of 8 / 4 / 2 / 1-cell blocks.
// Each block keeps subdividing while the local density (wordmark field + light) beats a jittered
// threshold, so the transition from sparse dot grid at the edges to continuous fine grain at the
// centre is stochastic: no rings, no bands. Every lit dot is the same one cell; only its spacing
// and tone change. Fine cells are dithered against a blue-noise threshold map (no Bayer lattice, no moire).
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
#define DEPTH_TX ${DEPTH.toFixed(1)}
#define HALO_TX ${HALO.toFixed(1)}
// knobs: letter dot density (base, wave swing, light), edge ramp and roughness (cells),
// letter dot tone, per-dot twinkle depth (letters twinkle at 35% of it), and the cool tint of field dots relative to paper
#define DENS_L 0.72
#define DENS_WAVE 0.25
#define DENS_LIGHT 0.32
#define EDGE_SOFT 2.2
#define EDGE_NOISE 2.6
#define TONE_L 0.97
#define TWINKLE 0.3
#define FIELD_TINT vec3(0.9, 0.94, 1.0)

uniform vec4  uView;      // x, y (bottom-left), w, h of the visible screen, in cells
uniform float uTime;
uniform vec2  uLight;     // light centre, in cells
uniform vec2  uVel;       // light velocity, in screen heights per second
uniform float uHover;
uniform float uIntro;
uniform vec4  uLogo;      // x, y (bottom-left), w, h of the wordmark, in cells
uniform vec2  uTexScale;  // content size / texture size
uniform vec2  uTexOff;    // margin / texture size
uniform vec2  uFlip[5];   // per letter: horizontal / vertical scale (-1..1, 0 = edge-on mid-flip)
uniform vec3  uInk;
uniform vec3  uPaper;
uniform sampler2D uMask;
uniform sampler2D uBlue;
uniform float uTexPerCell; // wordmark texels per cell

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float blue(vec2 cell) {
  return texture2D(uBlue, (mod(cell, 64.0) + 0.5) / 64.0).r;
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash3(i),                       hash3(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

// --- the light: a long, soft falloff (not a disc), its edge bent by slow noise, breathing,
// and stretched into a short tail behind the direction it is moving
float lightAt(vec2 p) {
  vec2 d = (p - uLight) / uView.w;
  float sp = length(uVel);
  if (sp > 0.001) {
    vec2 vn = uVel / sp;
    float a = dot(d, vn);
    d -= vn * min(a, 0.0) * clamp(sp * 0.45, 0.0, 0.55);
  }
  vec2 w = vec2(
    vnoise(vec3(d * 2.4, uTime * 0.16)),
    vnoise(vec3(d * 2.4 + vec2(5.2, 1.3), uTime * 0.13 + 3.0))
  ) - 0.5;
  float r = length(d * vec2(0.85, 1.0) + w * 0.24);
  float breathe = 1.0 + 0.08 * sin(uTime * 0.83) + 0.05 * sin(uTime * 1.37 + 1.0);
  return exp(-r * 6.0 / breathe);
}

// --- the field: 1 at the wordmark, falling off toward the edges as an ellipse fitted to the screen,
// warped by slow noise so it reads like a cloud
float fieldAt(vec2 p) {
  vec2 lc = uLogo.xy + 0.5 * uLogo.zw;
  vec2 e = (p - lc) / (0.5 * uView.zw);
  vec2 n = (p - lc) / uView.w;
  vec2 w = vec2(
    vnoise(vec3(n * 1.3 + vec2(3.1, 1.7), uTime * 0.035)),
    vnoise(vec3(n * 1.3 + vec2(8.2, 4.4), uTime * 0.035 + 9.0))
  ) - 0.5;
  float r = length(e * vec2(1.0, 0.82) + w * 0.75);
  return exp(-r * r * 3.0);
}

// density: how much detail a spot gets. "lt" returns the light there; the result also drives tone.
float densityAt(vec2 p, out float lt) {
  lt = lightAt(p) * uHover; // the field only lights up where someone is pointing
  float yv = (p.y - uView.y) / uView.w;
  float calm = smoothstep(0.0, 0.15, min(yv, 1.0 - yv)); // breathing room behind the labels
  float fill = smoothstep(0.0, 1.0, uIntro * 1.25);
  return ((0.06 + 0.94 * fieldAt(p)) * (0.35 + 0.65 * calm) + lt * (0.32 + 0.3 * uHover)) * fill;
}

// the wordmark and a soft oval around it always get full resolution, whatever the screen shape
float keepFine(vec2 p) {
  vec2 e = (p - (uLogo.xy + 0.5 * uLogo.zw)) / (uLogo.zw * vec2(0.75, 2.0));
  return 1.0 - smoothstep(0.55, 1.0, length(e));
}

// which of the five letters this x belongs to (C R D Z C)
float letterIndex(float u) {
  return step(18.55 / 90.0, u) + step(36.15 / 90.0, u) + step(54.75 / 90.0, u) + step(71.15 / 90.0, u);
}
float letterCenter(float li) {
  if (li < 0.5) return 8.9 / 90.0;
  if (li < 1.5) return 27.35 / 90.0;
  if (li < 2.5) return 45.45 / 90.0;
  if (li < 3.5) return 62.95 / 90.0;
  return 80.8 / 90.0;
}
vec2 letterBounds(float li) {
  if (li < 0.5) return vec2(-1.0, 18.55 / 90.0);
  if (li < 1.5) return vec2(18.55 / 90.0, 36.15 / 90.0);
  if (li < 2.5) return vec2(36.15 / 90.0, 54.75 / 90.0);
  if (li < 3.5) return vec2(54.75 / 90.0, 71.15 / 90.0);
  return vec2(71.15 / 90.0, 2.0);
}
vec2 flipFor(float li) {
  vec2 f = vec2(1.0);
  for (int i = 0; i < 5; i++) {
    if (abs(float(i) - li) < 0.5) f = uFlip[i];
  }
  // never exactly zero: the letter collapses to a hairline instead of dividing by zero
  return vec2(f.x < 0.0 ? min(f.x, -0.02) : max(f.x, 0.02), f.y < 0.0 ? min(f.y, -0.02) : max(f.y, 0.02));
}
vec4 maskAt(vec2 tc) {
  float inside = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
  return texture2D(uMask, tc) * inside;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float lt;

  // ---- quadtree: 8 → 4 → 1 cells, each step taken only where density beats a jittered threshold
  float sz = 8.0;
  vec2 blk = floor(cell / 8.0);
  vec2 c8 = (blk + 0.5) * 8.0;
  float D = densityAt(c8, lt);
  if (max(D, keepFine(c8)) > 0.2 + 0.22 * (hash2(blk) - 0.5)) {
    sz = 4.0;
    blk = floor(cell / 4.0);
    vec2 c4 = (blk + 0.5) * 4.0;
    D = densityAt(c4, lt);
    if (max(D, keepFine(c4)) > 0.44 + 0.24 * (hash2(blk + 31.7) - 0.5)) {
      sz = 1.0;
      blk = cell;
      D = densityAt(cell + 0.5, lt);
    }
  }

  float on = 0.0;
  float tone = 0.0;
  vec3 tint = vec3(1.0);

  if (sz > 1.5) {
    // ---- sparse field: one dot per block, same size everywhere; spacing and tone carry the gradient
    vec2 inBlk = cell - blk * sz;
    float spot = floor(sz * 0.5 - 0.5);
    float isDot = step(abs(inBlk.x - spot) + abs(inBlk.y - spot), 0.0);
    float h = hash2(blk * 1.31 + sz);
    float present = step(h, (0.45 + 1.4 * D) * smoothstep(0.0, 0.7, uIntro));
    float twinkle = 0.82 + 0.18 * sin(uTime * (0.5 + h) + h * 40.0);
    on = isDot * present;
    tone = (0.2 + 0.12 * D + 0.4 * lt) * twinkle;
    tint = FIELD_TINT;
  } else {
    // ---- fine field: the wordmark and the cloud around it, dithered cell by cell
    vec2 c = cell + 0.5;
    vec2 q = (c - uLogo.xy) / uLogo.zw;
    float aspect = uLogo.z / uLogo.w;

    // each letter can flip, horizontally or vertically, around its own centre
    float li = letterIndex(q.x);
    vec2 fs = flipFor(li);
    float cu = letterCenter(li);
    vec2 qf = vec2(cu + (q.x - cu) / fs.x, 0.5 + (q.y - 0.5) / fs.y);
    vec2 bnd = letterBounds(li);
    float inBox = step(bnd.x, qf.x) * step(qf.x, bnd.y) * step(-0.05, qf.y) * step(qf.y, 1.05);

    // entrance: each letter dissolves in, one after the other, drifting up a little
    float e = clamp(uIntro * 1.6 - li * 0.12, 0.0, 1.0);
    float eo = 1.0 - pow(1.0 - e, 3.0);
    vec2 rise = vec2(0.0, 0.18 * (1.0 - eo));

    vec2 tc = (qf + rise) * uTexScale + uTexOff;
    vec4 t = maskAt(tc);
    // signed distance to the letter's edge, in cells (+ inside, - outside), from the two distance fields
    // (a squeezed letter packs more texels per cell, so its edge loosens while it turns)
    float tpc = uTexPerCell / max(min(abs(fs.x), abs(fs.y)), 0.15);
    float sd = (t.r > 0.5 ? t.g * DEPTH_TX : -(1.0 - t.b) * HALO_TX) / tpc;

    float th = blue(cell);
    vec2 pc = (c - (uLogo.xy + 0.5 * uLogo.zw)) / uView.w;
    float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
    // a slow brightness wave drifting through field and letters alike
    float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;

    // ---- one material. Field and letters are the same single-cell dots on the same blue-noise threshold;
    // a letter is only a region where they gather (higher density) and burn brighter. Its boundary is a
    // density ramp a few cells wide, roughened by noise, so a few dots stray outside and a few gaps open
    // inside: the shape is perceived from where the dots gather, never drawn.
    float rough = (vnoise(vec3(c * 0.33, uTime * 0.25)) - 0.5) * EDGE_NOISE;
    float letter = smoothstep(-EDGE_SOFT, EDGE_SOFT, sd + rough) * inBox * smoothstep(0.0, 1.0, eo * 1.1);

    float lumC = ((0.03 + 0.1 * nz * nz) * (1.0 + 0.6 * wave) + 0.12 * lt) * smoothstep(0.0, 0.7, uIntro);
    float lumL = 0.0;
    float glow = 0.0;
    if (letter > 0.0) {
      glow = lightAt(c); // the light energises the letters' dots even when nobody is pointing
      float edgeOn = abs(fs.x * fs.y);
      lumL = (DENS_L + 0.5 * wave * DENS_WAVE + DENS_LIGHT * glow) * (0.55 + 0.45 * edgeOn);
    }
    float lum = mix(lumC * 1.4, lumL, letter);
    // every dot sits on one checkerboard lattice, so dots touch at most at a corner and never fuse into
    // worms: up close it is always discrete dots, in the letters as in the field
    float site = 1.0 - mod(cell.x + cell.y, 2.0);
    on = site * step(th, lum);

    // tone: every dot twinkles on its own slow phase; letter dots are paper-white, field dots dimmer and a
    // touch cooler
    float h = hash2(cell);
    float tw = 0.5 + 0.5 * sin(uTime * (0.6 + 1.6 * h) + h * 60.0);
    float toneC = (0.32 + 0.4 * lt) * (1.0 - TWINKLE * tw);
    float toneL = (TONE_L + (1.0 - TONE_L) * glow) * (1.0 - 0.35 * TWINKLE * tw);
    tone = mix(toneC, toneL, letter);
    tint = mix(FIELD_TINT, vec3(1.0), letter);
  }

  gl_FragColor = vec4(mix(uInk, uPaper * tint * clamp(tone, 0.0, 1.0), on), 1.0);
}
`;

function createScene() {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (console.warn(gl.getShaderInfoLog(s)), null);
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  // full-screen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // the wordmark (clamped, linear)
  const wm = buildWordmarkTexture();
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, wm.tw, wm.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, wm.data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // the blue-noise threshold map (repeats, nearest)
  const bn = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, bn);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const u = (name) => gl.getUniformLocation(prog, name);
  const U = {
    view: u("uView"), time: u("uTime"), light: u("uLight"), vel: u("uVel"), hover: u("uHover"),
    intro: u("uIntro"), logo: u("uLogo"), flip: u("uFlip[0]"), tpc: u("uTexPerCell"),
  };
  gl.uniform3fv(u("uInk"), INK);
  gl.uniform3fv(u("uPaper"), PAPER);
  gl.uniform1i(u("uMask"), 0);
  gl.uniform1i(u("uBlue"), 1);
  gl.uniform2f(u("uTexScale"), wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(u("uTexOff"), MARGIN / wm.tw, MARGIN / wm.th);

  // One canvas texel = one dither cell = CELL device pixels (an integer, so upscaling stays crisp).
  // A cell is ~1/80 of the wordmark's height, between 1 and 1.5 CSS px, and never under 2 device px:
  // 1.5 CSS px on a 2× laptop, 1 CSS px on a 2× or 3× phone, 2 CSS px on a 1× screen.
  const dpr = window.devicePixelRatio || 1;
  let s = 1; // cells per CSS px
  let viewH = 1; // visible hero height, CSS px
  let canvasCssH = 1;

  const resize = () => {
    const hr = hero.getBoundingClientRect();
    const cssCell = clamp(logoSvg.getBoundingClientRect().height / 80, 1, 1.5);
    const CELL = Math.max(2, Math.round(dpr * cssCell));
    s = dpr / CELL;
    const cw = Math.max(1, Math.ceil(hr.width * s));
    const ch = Math.max(1, Math.ceil(hr.height * s));
    canvas.width = cw;
    canvas.height = ch;
    // the canvas covers the hero and spills by < 1 cell, so each texel maps to exactly CELL device px
    canvas.style.width = `${cw / s}px`;
    canvas.style.height = `${ch / s}px`;
    canvasCssH = ch / s;
    viewH = hr.height;
    gl.viewport(0, 0, cw, ch);
    gl.uniform4f(U.view, 0, (canvasCssH - viewH) * s, hr.width * s, hr.height * s);
  };
  new ResizeObserver(() => {
    resize();
    if (reduce) draw();
  }).observe(hero);
  resize();

  // CSS px in the hero (y down) → cells (y up)
  const toCells = (x, y) => [x * s, (canvasCssH - y) * s];

  function draw() {
    const hr = hero.getBoundingClientRect();
    const [l, t, w, h] = state.logoCss;
    const [lx, ly] = toCells(l - hr.left, t - hr.top + h);
    gl.uniform4f(U.logo, lx, ly, w * s, h * s);
    gl.uniform1f(U.tpc, wm.ch / Math.max(1, h * s));
    const [px, py] = toCells(state.light[0], state.light[1]);
    gl.uniform2f(U.light, px, py);
    gl.uniform2f(U.vel, state.lightVel[0] / viewH, -state.lightVel[1] / viewH);
    gl.uniform1f(U.time, state.time);
    gl.uniform1f(U.hover, state.hover);
    gl.uniform1f(U.intro, state.intro);
    gl.uniform2fv(U.flip, flipUniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    html.classList.remove("gl");
  });

  return { draw };
}

// ------------------------------------------------------------------ pointer
window.addEventListener(
  "pointermove",
  (e) => {
    const r = hero.getBoundingClientRect();
    state.target[0] = e.clientX - r.left;
    state.target[1] = e.clientY - r.top;
    state.lastPointer = performance.now();
    state.inside = true;
    pointerLetter(e, false);
  },
  { passive: true }
);
window.addEventListener("pointerdown", (e) => pointerLetter(e, true), { passive: true }); // taps flip letters on touch screens
html.addEventListener("pointerleave", () => {
  state.inside = false;
});

// ------------------------------------------------------------------ loop
const scene = createScene();
if (scene) html.classList.add("gl");

measureLogo();
new ResizeObserver(measureLogo).observe(hero);

// the light starts resting just off the wordmark's upper left, where it will idle from
function idleTarget(t) {
  const hr = hero.getBoundingClientRect();
  const [l, top, w, h] = state.logoCss;
  const cx = l - hr.left + w / 2;
  const cy = top - hr.top + h / 2;
  // two incommensurate slow sines: a wandering, never-repeating drift over the wordmark
  return [
    cx + w * (0.34 * Math.sin(t * 0.19) + 0.1 * Math.sin(t * 0.47 + 2.0)),
    cy + h * (0.9 * Math.sin(t * 0.31 + 1.0) + 0.35 * Math.sin(t * 0.13)),
  ];
}
{
  // reduced motion: one still frame, the light parked above the wordmark's upper left
  const [l, top, w] = state.logoCss;
  const hr = hero.getBoundingClientRect();
  const [x, y] = reduce ? [l - hr.left + w * 0.3, top - hr.top - w * 0.12] : idleTarget(0);
  state.light = [x, y];
  state.target = [x, y];
}

let visible = true;
new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(hero);

let last = 0;
const t0 = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden) return;
  const dtMs = now - last;
  if (dtMs < (coarse ? 32 : 15)) return; // ~30fps on touch devices, ~60fps elsewhere
  last = now;
  const dt = Math.min(dtMs, 64) / 1000;

  state.time = (now - t0) / 1000;

  // when nobody is steering, the light wanders slowly over the wordmark by itself
  const idle = now - state.lastPointer > 3000;
  const [tx, ty] = idle ? idleTarget(state.time) : state.target;

  // the light hangs on a soft spring: it lags, swings a little past, and settles
  const k = idle ? 6 : 34;
  const c = idle ? 5 : 9.5;
  for (let a = 0; a < 2; a++) {
    const tgt = a === 0 ? tx : ty;
    state.lightVel[a] += ((tgt - state.light[a]) * k - state.lightVel[a] * c) * dt;
    state.light[a] += state.lightVel[a] * dt;
  }
  const ease = 1 - Math.exp(-dt * (state.inside && !idle ? 2.2 : 0.9));
  state.hover += ease * ((state.inside && !idle ? 1 : 0) - state.hover);

  updateFlips(now);
  scene?.draw();
}

// ------------------------------------------------------------------ boot sequence
function tween(ms, fn) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = clamp01((now - start) / ms);
      fn(t);
      t < 1 ? requestAnimationFrame(step) : resolve();
    };
    requestAnimationFrame(step);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = (() => {
  try {
    return sessionStorage.getItem("cc-boot") === "1";
  } catch {
    return false;
  }
})();
const forced = new URLSearchParams(location.search).has("boot");

async function boot() {
  if (reduce) {
    html.classList.add("ready");
    if (scene) scene.draw();
    else flipSvg();
    return;
  }

  requestAnimationFrame(frame);

  if (seen && !forced) {
    // returning visitor: skip the console, keep the entrance
    html.classList.add("quick");
    await tween(1600, (t) => {
      state.intro = t;
    });
    html.classList.remove("booting");
    html.classList.add("ready");
    flipsArmed = true;
    return;
  }

  const count = hero.querySelector("[data-count]");
  const bar = hero.querySelector("[data-bar]");
  const lines = [...hero.querySelectorAll(".boot__log li")];

  lines.forEach((li, i) => setTimeout(() => li.classList.add("on"), 250 + i * 380));

  // the counter runs; as it nears 100 the field starts filling in and the letters dissolve into view
  const counter = tween(2000, (t) => {
    const e = easeInOutCubic(t);
    count.textContent = String(Math.round(e * 100)).padStart(3, "0");
    bar.style.transform = `scaleX(${e})`;
  });
  const entrance = wait(1450).then(() =>
    tween(2100, (t) => {
      state.intro = t;
    })
  );

  await counter;
  html.classList.add("boot-done");
  await Promise.all([entrance, wait(260)]);
  html.classList.remove("booting");
  html.classList.add("ready");
  flipsArmed = true; // from now on, letters flip when the pointer touches them

  try {
    sessionStorage.setItem("cc-boot", "1");
  } catch {
    /* storage unavailable: the boot simply plays again next time */
  }
}

boot();
