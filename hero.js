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
      // quart in-out: the letter leaves slowly, snaps through edge-on, and settles softly
      const s = Math.cos(Math.PI * easeInOutQuart(t));
      if (f.axis === "x") sx = f.mx * s;
      else sy = f.my * s;
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
//   R coverage · G depth inside the letter (distance to its edge) · B halo outside the letters.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const MARGIN = 110; // transparent border (texels) so the halo fits and sampling past the edge reads 0
const DEPTH = 30; // texels: how far in from an edge the "depth" keeps growing
const HALO = 90; // texels: reach of the dark halo around the letters

function distanceTransform(mask, w, h, seed) {
  // two-pass chamfer (3-4), returns thirds of a texel; 0 where mask === seed
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === seed ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  return d;
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
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = rgba[i * 4] > 127 ? 1 : 0;

  const inside = distanceTransform(solid, tw, th, 0); // letter texels: distance to the nearest outside texel
  const outside = distanceTransform(solid, tw, th, 1); // outside texels: distance to the nearest letter texel

  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = rgba[i * 4];
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / 3 / DEPTH) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / 3 / HALO) * 255);
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
  return exp(-r * 5.2 / breathe);
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
  lt = lightAt(p) * (0.45 + 0.55 * uHover);
  float yv = (p.y - uView.y) / uView.w;
  float calm = smoothstep(0.0, 0.15, min(yv, 1.0 - yv)); // breathing room behind the labels
  float fill = smoothstep(0.0, 1.0, uIntro * 1.25);
  return ((0.06 + 0.94 * fieldAt(p)) * (0.35 + 0.65 * calm) + lt * (0.32 + 0.3 * uHover)) * fill;
}

// the wordmark and a soft oval around it always get full resolution, whatever the screen shape
float keepFine(vec2 p) {
  vec2 e = (p - (uLogo.xy + 0.5 * uLogo.zw)) / (uLogo.zw * vec2(0.62, 1.9));
  return 1.0 - smoothstep(0.8, 1.0, length(e));
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

  if (sz > 1.5) {
    // ---- sparse field: one dot per block, same size everywhere; spacing and tone carry the gradient
    vec2 inBlk = cell - blk * sz;
    float spot = floor(sz * 0.5 - 0.5);
    float isDot = step(abs(inBlk.x - spot) + abs(inBlk.y - spot), 0.0);
    float h = hash2(blk * 1.31 + sz);
    float present = step(h, (0.45 + 1.4 * D) * smoothstep(0.0, 0.7, uIntro));
    float twinkle = 0.82 + 0.18 * sin(uTime * (0.5 + h) + h * 40.0);
    on = isDot * present;
    tone = (0.23 + 0.4 * D + 0.4 * lt) * twinkle;
  } else {
    // ---- fine field: the wordmark and the cloud around it, dithered cell by cell
    vec2 c = cell + 0.5;
    vec2 q0 = (c - uLogo.xy) / uLogo.zw;
    float aspect = uLogo.z / uLogo.w;

    // the outlines bend a touch, and only where the light is
    vec2 qa0 = vec2(q0.x * aspect, q0.y);
    vec2 wob = vec2(
      vnoise(vec3(qa0 * 2.2, uTime * 0.3)),
      vnoise(vec3(qa0 * 2.2 + vec2(7.3, 2.9), uTime * 0.27))
    ) - 0.5;
    float amp = 0.012 * lt * uHover;
    vec2 q = q0 + vec2(wob.x * amp / aspect, wob.y * amp) * 2.0;

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

    vec4 t = maskAt((qf + rise) * uTexScale + uTexOff);
    float cov = smoothstep(0.4, 0.6, t.r) * inBox;
    float depth = t.g;
    float halo = maskAt((q + rise) * uTexScale + uTexOff).b;

    float th = blue(cell);

    // letters: restrained paper, a soft grain that thickens toward the edges, brighter in the light,
    // dimmer while edge-on in a flip
    vec2 pc = (c - (uLogo.xy + 0.5 * uLogo.zw)) / uView.w;
    float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;

    float edgeOn = abs(fs.x * fs.y);
    float lumL = (1.02 - 0.08 * nz - 0.4 * (1.0 - smoothstep(0.0, 0.32, depth)) + 0.06 * lt) * smoothstep(0.0, 1.0, eo * 1.1);
    float onL = step(th, lumL * (0.75 + 0.25 * edgeOn));
    float toneL = (0.8 + 0.18 * lt) * (0.6 + 0.4 * edgeOn);

    // cloud: sparse fine grain, organic through noise, kept dark close to the letters (soft halo)
    float clear = 1.0 - 0.92 * smoothstep(0.35, 0.95, halo);
    float lumC = ((0.025 + 0.15 * smoothstep(0.5, 1.0, D)) * (0.35 + 1.3 * nz) + 0.11 * lt) * clear * smoothstep(0.0, 0.7, uIntro);
    float onC = step(th, lumC);
    float toneC = 0.3 + 0.18 * D + 0.5 * lt;

    on = mix(onC, onL, cov);
    tone = mix(toneC, toneL, cov);
  }

  gl_FragColor = vec4(mix(uInk, uPaper * clamp(tone, 0.0, 1.0), on), 1.0);
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
    intro: u("uIntro"), logo: u("uLogo"), flip: u("uFlip[0]"),
  };
  gl.uniform3fv(u("uInk"), INK);
  gl.uniform3fv(u("uPaper"), PAPER);
  gl.uniform1i(u("uMask"), 0);
  gl.uniform1i(u("uBlue"), 1);
  gl.uniform2f(u("uTexScale"), wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(u("uTexOff"), MARGIN / wm.tw, MARGIN / wm.th);

  // One canvas texel = one dither cell = CELL device pixels (an integer, so upscaling stays crisp):
  // 1.5 CSS px on a 2× screen, 2 on a 1× screen, ~1.7 on a 3× phone.
  const dpr = window.devicePixelRatio || 1;
  const CELL = Math.max(2, Math.round(dpr * 1.5));
  const s = dpr / CELL; // cells per CSS px
  let viewH = 1; // visible hero height, CSS px
  let canvasCssH = 1;

  const resize = () => {
    const hr = hero.getBoundingClientRect();
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
  const [x, y] = idleTarget(reduce ? 6 : 0);
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
