// cardozo.cc hero — one canvas of dots. Every element of the interface (the CRDZC wordmark, the labels,
// the link container) is rendered *into* a single dithered dot field; the pointer is an "electron" that
// pushes that field around and sticks to the letters; a click on the background sends a wave across it.
// No dependencies. Everything degrades: no JS → static page; no WebGL → the SVG wordmark and the DOM
// links; prefers-reduced-motion → one still frame (still in dots), no boot, no flips, no waves.

import { distanceTransform, roundCorners, blueNoise } from "./raster.js";
import { createElements, rasterise, hoverTargets } from "./elements.js";

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
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ knobs (interaction, JS side)
// Distances in wordmark heights (h). Springs: angular frequency ω (1/s) and damping ratio ζ.
const ELECTRON_R = 22; // CSS px: radius of the electron's push
const ELECTRON_SPRING = [34, 1]; // fast and critically damped: precise, never overshoots
const ENTER = 0.2; // h: an electron this close to a letter's edge gets captured by it
const MAX_PULL = 0.42; // h: how far a bubble can stretch out of its letter before it lets go or hands over
const REARM = 1.5; // × ENTER: a released letter can capture again only after the electron got this far
const TURN_BACK = 0.14; // h: moving this far against the capture direction is a "direction change"
const BUBBLE_SPRING = [15, 0.55]; // the bubble's anchor: soft and a little gooey
const WAVE_LIFE = 1.9; // s
const MAX_WAVES = 4;

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : the field fills in and the letters dissolve into view
  ui: reduce ? 1 : 0, // 0 → 1 : the rendered UI dissolves in after the wordmark
  time: reduce ? 6 : 0,
  logoCss: [0, 0, 1, 1], // left, top, w, h of the wordmark (client px)
  // the electron, in hero CSS px
  e: { x: -1e4, y: -1e4, vx: 0, vy: 0, tx: -1e4, ty: -1e4, on: false, str: 0, sv: 0 },
  // the sticky bubble
  stuck: -1, // letter index, or -1 when free
  blob: { x: 0, y: 0, vx: 0, vy: 0, str: 0, sv: 0, letter: 0 },
  capDir: 1,
  capExtreme: 0,
  rearm: [true, true, true, true, true],
  hot: null, // hovered element { el, rect }
  hotAmt: 0,
  hotRect: [0, 0, 0, 0],
  focusRect: null,
  focusAmt: 0,
  waves: [], // { x, y, t0 } in hero CSS px, seconds
};

// ------------------------------------------------------------------ per-letter flips
// Every letter starts in a random orientation on every load. After that a letter flips only when the
// electron newly captures it (horizontally or vertically at random, around its own centre).
const LETTERS = 5;
const LETTER_EDGES = [-1, 18.55 / 90, 36.15 / 90, 54.75 / 90, 71.15 / 90, 2]; // gap midpoints, in u
const LETTER_CENTERS = [8.9 / 90, 27.35 / 90, 45.45 / 90, 62.95 / 90, 80.8 / 90];
// C and D look identical flipped vertically, so they lean horizontal; R and Z are fair game
const HORIZONTAL_BIAS = [0.8, 0.5, 0.8, 0.5, 0.8];
const flipUniform = new Float32Array(LETTERS * 2).fill(1);
const flips = Array.from({ length: LETTERS }, () => ({
  mx: Math.random() < 0.5 ? 1 : -1,
  my: Math.random() < 0.5 ? 1 : -1,
  axis: "x",
  flipping: false,
  t0: 0,
  dur: 0,
}));
const letterGroups = [...logoSvg.querySelectorAll(".lt")];
let flipsArmed = false;

flips.forEach((f, i) => {
  flipUniform[i * 2] = f.mx;
  flipUniform[i * 2 + 1] = f.my;
});

function flipSvg() {
  letterGroups.forEach((g, i) => {
    g.style.transform = `scale(${flipUniform[i * 2] || 0.001}, ${flipUniform[i * 2 + 1] || 0.001})`;
  });
}

function startFlip(i, now) {
  const f = flips[i];
  if (f.flipping || reduce) return;
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
      // quart in-out: leaves slowly, passes edge-on quickly, settles softly, never grows past its size
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

// no-WebGL fallback: a letter flips when the pointer enters it
function letterColumn(clientX, clientY) {
  const [l, t, w, h] = state.logoCss;
  const u = (clientX - l) / w;
  const v = (clientY - t) / h;
  if (u < 0 || u > 1 || v < -0.35 || v > 1.35) return -1;
  for (let i = 0; i < LETTERS; i++) if (u >= LETTER_EDGES[i] && u < LETTER_EDGES[i + 1]) return i;
  return -1;
}
let overLetter = -1;
function fallbackFlip(e, force) {
  if (!flipsArmed) return;
  const i = letterColumn(e.clientX, e.clientY);
  const entered = i !== overLetter;
  overLetter = i;
  if (i >= 0 && (entered || force)) startFlip(i, performance.now());
}

// ------------------------------------------------------------------ wordmark texture
// The SVG paths are rasterised once, their corners rounded, and per texel we store:
//   R coverage · G distance to the edge inside a letter · B closeness to a letter outside it.
// A CPU copy of the signed distance stays around for the electron's capture logic.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const TEX_H = VBH * TEXELS_PER_UNIT; // texels per wordmark height
const HALO = 170; // texels: range of the outside distance (must cover MAX_PULL)
const MARGIN = HALO + 10; // transparent border so outside distances fit and sampling past the edge reads 0
const DEPTH = 55; // texels: range of the inside distance
const ROUND_OPEN = 17; // texels (≈ 4.9% of the letter height): radius of the outer corners
const ROUND_CLOSE = 9; // texels (≈ 2.6%): radius of the inner corners

let wordmarkSD = null; // { sd: Float32Array (texels, + inside), tw, th, cw, ch }

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

  const inside = distanceTransform(solid, tw, th, 0);
  const outside = distanceTransform(solid, tw, th, 1);

  const data = new Uint8Array(n * 4);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    data[i * 4] = solid[i] * 255;
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / DEPTH) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / HALO) * 255);
    data[i * 4 + 3] = 255;
    sd[i] = solid[i] ? inside[i] : -outside[i];
  }
  wordmarkSD = { sd, tw, th, cw, ch };
  return { data, tw, th, cw, ch };
}

// signed distance (in wordmark heights, + inside) of a point (q: u across the wordmark, v up) to the
// letter in column i. Outside its column the distance keeps growing linearly.
function letterDistance(i, qx, qy, aspect) {
  const { sd, tw, cw, ch } = wordmarkSD;
  // the letter at full size in its resting orientation, even mid-flip, so capture never stalls on a flip
  const sx = flips[i].mx;
  const sy = flips[i].my;
  const cu = LETTER_CENTERS[i];
  const ux = cu + (qx - cu) / sx;
  const vy = 0.5 + (qy - 0.5) / sy;
  const lim = MARGIN / TEX_H - 0.02;
  const cx = clamp(ux, Math.max(LETTER_EDGES[i], -lim / aspect), Math.min(LETTER_EDGES[i + 1], 1 + lim / aspect));
  const cy = clamp(vy, -lim, 1 + lim);
  const extra = Math.hypot((ux - cx) * aspect, vy - cy);
  const tx = Math.round(MARGIN + cx * cw);
  const ty = Math.round(MARGIN + (1 - cy) * ch);
  return sd[ty * tw + tx] / TEX_H - extra;
}

// ------------------------------------------------------------------ shaders
// Two passes. FIELD runs at one fragment per dither cell into a texture; COMPOSE runs at device pixels,
// upscales the cells (each cell an exact CELL × CELL square) and dithers the UI text at device resolution.
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// shared by both passes: how the electron and the waves push the field around
const PUSH = `
uniform vec2  uDev;       // canvas size, device px
uniform vec3  uE;         // electron: x, y (device px), presence 0..1
uniform vec2  uEV;        // electron velocity, device px / s
uniform float uER;        // electron radius, device px
uniform vec4  uW[4];      // waves: x, y (device px), age (s, < 0 = off), amplitude
uniform float uTime;
uniform sampler2D uBlue;

#define PUSH_AMT 0.42      // radial push, × electron radius
#define DEFLECT 0.35       // sideways deflection at speed, × electron radius
#define RING 0.55          // density piled up where the pushed field compresses
#define WAKE 0.35          // density in the short wake behind a moving electron
#define WAVE_SPEED 0.95    // screen heights per second
#define WAVE_WIDTH 0.03    // screen heights
#define WAVE_PUSH 0.007    // screen heights
#define WAVE_DENS 0.55

float blue(vec2 p) {
  return texture2D(uBlue, (mod(p, 64.0) + 0.5) / 64.0).r;
}

// returns the displacement (device px) to subtract from a sample position, and in .z the extra density
// where the field is compressed (the ring around the electron, its wake, the wave fronts)
vec3 pushAt(vec2 p) {
  vec3 o = vec3(0.0);
  vec2 d = p - uE.xy;
  float r = length(d) + 0.001;
  vec2 dir = d / r;
  float R = uER;
  float f = uE.z * exp(-(r * r) / (R * R));
  float sp = length(uEV);
  float fast = clamp(sp / (R * 14.0), 0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  // like a charge moving through a field: pushed outward, and bent sideways relative to the motion
  float side = sign(dir.x * uEV.y - dir.y * uEV.x);
  o.xy += dir * PUSH_AMT * R * f;
  o.xy += perp * side * DEFLECT * R * f * fast;
  o.z += uE.z * RING * exp(-pow((r - 1.15 * R) / (0.4 * R), 2.0));
  if (sp > 1.0) {
    vec2 tail = uE.xy - uEV * 0.07;
    o.z += uE.z * WAKE * fast * exp(-dot(p - tail, p - tail) / (R * R * 1.4));
  }
  for (int i = 0; i < 4; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    vec2 dw = p - w.xy;
    float rw = length(dw) + 0.001;
    float front = w.z * WAVE_SPEED * uDev.y;
    float ring = exp(-pow((rw - front) / (WAVE_WIDTH * uDev.y), 2.0)) * w.w;
    o.xy += dw / rw * ring * WAVE_PUSH * uDev.y;
    o.z += ring * WAVE_DENS;
  }
  return o;
}
`;

const FIELD = `
precision highp float;
#define DEPTH_TX ${DEPTH.toFixed(1)}
#define HALO_TX ${HALO.toFixed(1)}

// ---- knobs
#define DENS_L 0.72        // share of lattice sites lit inside a letter
#define DENS_WAVE 0.25     // swing of the slow brightness wave inside letters
#define DENS_E 0.3         // extra letter density around the electron
#define EDGE_SOFT 3.6      // letter edge: width of the density ramp, in cells (merges with the field)
#define EDGE_HOVER 0.3     // … × this right around the electron (crisper there)
#define EDGE_NOISE 2.2     // roughness of that ramp, in cells
#define TONE_L 0.97        // letter dot tone
#define TWINKLE 0.3        // per-dot twinkle depth (letters at 35% of it)
#define FIELD_TINT vec3(0.9, 0.94, 1.0)
#define BLOB_R 0.09        // bubble radius, × wordmark height
#define NECK_K 0.6         // bubble neck (smooth-union width), × wordmark height
#define CORE 0.32          // electron core radius, × electron radius
#define LINE_TONE 0.5      // UI shapes (borders)
#define AREA_QUIET 0.25    // field density under a UI element
#define HOT_DENS 0.16      // fill of a hovered UI element
#define IMG_DENS 0.9       // image tone → dot density

${PUSH}

uniform vec2  uCells;     // field size, in cells
uniform float uCell;      // device px per cell
uniform float uIntro;
uniform float uUi;
uniform vec4  uLogo;      // x, y (bottom-left), w, h of the wordmark, in cells
uniform vec2  uTexScale;
uniform vec2  uTexOff;
uniform float uTexPerCell;
uniform vec2  uFlip[5];
uniform vec4  uBlob;      // bubble: x, y (device px), strength, letter index
uniform vec4  uHot;       // hovered UI element, device px (x0, y0, x1, y1)
uniform float uHotAmt;
uniform vec4  uFocus;     // keyboard-focused UI element, device px
uniform float uFocusAmt;
uniform vec3  uInk;
uniform vec3  uPaper;
uniform sampler2D uMask;
uniform sampler2D uUI;

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
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
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 0.0001);
  return min(a, b) - h * h * k * 0.25;
}
float inRect(vec2 p, vec4 r) {
  return step(r.x, p.x) * step(p.x, r.z) * step(r.y, p.y) * step(p.y, r.w);
}

// the field: 1 at the wordmark, falling off toward the edges, warped by slow noise
float fieldAt(vec2 p) {
  vec2 lc = uLogo.xy + 0.5 * uLogo.zw;
  vec2 e = (p - lc) / (0.5 * uCells);
  vec2 n = (p - lc) / uCells.y;
  vec2 w = vec2(
    vnoise(vec3(n * 1.3 + vec2(3.1, 1.7), uTime * 0.035)),
    vnoise(vec3(n * 1.3 + vec2(8.2, 4.4), uTime * 0.035 + 9.0))
  ) - 0.5;
  float r = length(e * vec2(1.0, 0.82) + w * 0.75);
  return exp(-r * r * 3.0);
}
float densityAt(vec2 p) {
  float yv = p.y / uCells.y;
  float calm = smoothstep(0.0, 0.15, min(yv, 1.0 - yv)); // breathing room behind the labels
  float fill = smoothstep(0.0, 1.0, uIntro * 1.25);
  return (0.06 + 0.94 * fieldAt(p)) * (0.35 + 0.65 * calm) * fill;
}
// full resolution around the wordmark, around the electron and on the wave fronts
float keepFine(vec2 p) {
  vec2 e = (p - (uLogo.xy + 0.5 * uLogo.zw)) / (uLogo.zw * vec2(0.75, 2.0));
  float k = 1.0 - smoothstep(0.55, 1.0, length(e));
  vec2 pd = p * uCell;
  k = max(k, uE.z * (1.0 - smoothstep(2.5, 4.0, length(pd - uE.xy) / uER)));
  for (int i = 0; i < 4; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    float front = w.z * WAVE_SPEED * uDev.y;
    k = max(k, w.w * exp(-pow((length(pd - w.xy) - front) / (3.0 * WAVE_WIDTH * uDev.y), 2.0)));
  }
  return k;
}

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
  return vec2(f.x < 0.0 ? min(f.x, -0.02) : max(f.x, 0.02), f.y < 0.0 ? min(f.y, -0.02) : max(f.y, 0.02));
}
vec4 maskAt(vec2 tc) {
  float inside = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
  return texture2D(uMask, tc) * inside;
}
// signed distance (cells, + inside) to letter li as currently flipped; it keeps growing outside the
// letter's column, so a bubble can stretch across a gap without picking up the neighbour's shape
float letterSD(float li, vec2 q, float aspect) {
  vec2 fs = flipFor(li);
  float cu = letterCenter(li);
  vec2 qf = vec2(cu + (q.x - cu) / fs.x, 0.5 + (q.y - 0.5) / fs.y);
  vec2 b = letterBounds(li);
  vec2 qc = vec2(clamp(qf.x, b.x, b.y), clamp(qf.y, -0.45, 1.45));
  float extra = length((qf - qc) * vec2(aspect, 1.0)) * uLogo.w;
  vec4 t = maskAt(qc * uTexScale + uTexOff);
  float tpc = uTexPerCell / max(min(abs(fs.x), abs(fs.y)), 0.15);
  return (t.r > 0.5 ? t.g * DEPTH_TX : -(1.0 - t.b) * HALO_TX) / tpc - extra;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 pDev = (cell + 0.5) * uCell;
  vec3 push = pushAt(pDev);
  vec2 c = (pDev - push.xy) / uCell; // where this cell samples the scene from (displaced), in cells
  float rE = length(pDev - uE.xy);
  float eNear = uE.z * exp(-pow(rE / (3.0 * uER), 2.0));
  float site = 1.0 - mod(cell.x + cell.y, 2.0); // one checkerboard lattice for every dot
  float th = blue(cell);

  // ---- quadtree: 8 → 4 → 1 cells, each step taken where density beats a jittered threshold
  float sz = 8.0;
  vec2 blk = floor(cell / 8.0);
  vec2 c8 = (blk + 0.5) * 8.0;
  float D = densityAt(c8);
  if (max(D, keepFine(c8)) > 0.2 + 0.22 * (hash2(blk) - 0.5)) {
    sz = 4.0;
    blk = floor(cell / 4.0);
    vec2 c4 = (blk + 0.5) * 4.0;
    D = densityAt(c4);
    if (max(D, keepFine(c4)) > 0.44 + 0.24 * (hash2(blk + 31.7) - 0.5)) {
      sz = 1.0;
      blk = cell;
      D = densityAt(c);
    }
  }

  // the UI layer, sampled where the field is displaced to (so the electron and waves move it too)
  vec4 ui = texture2D(uUI, (c * uCell) / uDev);
  float area = step(0.1, ui.g);
  float shape = clamp((ui.g - 0.25) / 0.75, 0.0, 1.0);
  float quiet = mix(1.0, AREA_QUIET, area * uUi) * (1.0 - 0.8 * step(0.02, ui.r) * uUi);

  float on = 0.0;
  float tone = 0.0;
  vec3 tint = FIELD_TINT;
  float h = hash2(cell);
  float tw = 0.5 + 0.5 * sin(uTime * (0.6 + 1.6 * h) + h * 60.0);

  if (sz > 1.5) {
    // ---- sparse field: one dot per block
    vec2 inBlk = cell - blk * sz;
    float spot = floor(sz * 0.5 - 0.5);
    float isDot = step(abs(inBlk.x - spot) + abs(inBlk.y - spot), 0.0);
    float hb = hash2(blk * 1.31 + sz);
    float present = step(hb, (0.45 + 1.4 * D) * smoothstep(0.0, 0.7, uIntro) * quiet);
    on = isDot * present;
    tone = (0.2 + 0.12 * D) * (1.0 - TWINKLE * tw);
  } else {
    // ---- fine field: the wordmark and the cloud around it
    vec2 q = (c - uLogo.xy) / uLogo.zw;
    float aspect = uLogo.z / uLogo.w;
    float li = letterIndex(q.x);
    vec2 fs = flipFor(li);

    // entrance: each letter dissolves in, one after the other, drifting up a little
    float e = clamp(uIntro * 1.6 - li * 0.12, 0.0, 1.0);
    float eo = 1.0 - pow(1.0 - e, 3.0);
    vec2 qr = q - vec2(0.0, 0.18 * (1.0 - eo));

    float sd = letterSD(li, qr, aspect);
    // the sticky bubble: the captured letter's shape, smoothly united with a blob at the electron
    if (uBlob.z > 0.001) {
      float bs = uBlob.z;
      float dB = length(pDev - uBlob.xy) / uCell - BLOB_R * uLogo.w * bs;
      float dL = -letterSD(uBlob.w, qr, aspect);
      sd = max(sd, -smin(dL, dB, NECK_K * uLogo.w * bs));
    }

    vec2 pc = (c - (uLogo.xy + 0.5 * uLogo.zw)) / uCells.y;
    float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
    float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;

    // one material: a letter is only where the same dots gather and burn brighter. Its boundary is a wide
    // density ramp roughened by noise (dots stray out, gaps open in), crisper right around the electron.
    float rough = (vnoise(vec3(c * 0.3, uTime * 0.25)) - 0.5) * EDGE_NOISE;
    float soft = EDGE_SOFT * mix(1.0, EDGE_HOVER, eNear);
    float letter = smoothstep(-soft, soft, sd + rough * mix(1.0, 0.4, eNear)) * smoothstep(0.0, 1.0, eo * 1.1);

    float lumC = ((0.03 + 0.1 * nz * nz) * (1.0 + 0.6 * wave) + push.z * 0.35) * smoothstep(0.0, 0.7, uIntro);
    float edgeOn = abs(fs.x * fs.y);
    float lumL = (DENS_L + 0.5 * wave * DENS_WAVE + DENS_E * eNear + push.z * 0.3) * (0.55 + 0.45 * edgeOn);
    float lum = mix(lumC * 1.4 * quiet, lumL, letter);
    on = site * step(th, lum);
    float toneC = 0.32 + 0.3 * eNear + 0.3 * push.z;
    float toneL = TONE_L;
    tone = mix(toneC * (1.0 - TWINKLE * tw), toneL * (1.0 - 0.35 * TWINKLE * tw), letter);
    tint = mix(FIELD_TINT, vec3(1.0), letter);

    // the electron's core: a small, precise knot of bright dots
    float core = uE.z * (1.0 - smoothstep(CORE * 0.6, CORE, rE / uER));
    if (site * step(th, core) > 0.5) {
      on = 1.0;
      tone = 1.0;
      tint = vec3(1.0);
    }
  }

  // ---- UI shapes (borders, SVG, images) and states, as dots on the same lattice
  float hot = inRect(pDev, uHot) * uHotAmt;
  float uiLum = (shape * (1.0 + hot * 0.6) + area * (ui.b * IMG_DENS + hot * HOT_DENS) + push.z * area * 0.3) * uUi;
  if (site * step(th, uiLum) > 0.5) {
    on = 1.0;
    tone = mix(LINE_TONE, 0.95, max(hot, ui.b)) * (1.0 - 0.5 * TWINKLE * tw);
    tint = vec3(1.0);
  }
  // keyboard focus: a dotted ring just outside the element
  vec2 fc = 0.5 * (uFocus.xy + uFocus.zw);
  vec2 fh = 0.5 * (uFocus.zw - uFocus.xy) + 4.0 * uCell;
  vec2 fq = abs(pDev - fc) - fh;
  float fd = length(max(fq, 0.0)) + min(max(fq.x, fq.y), 0.0);
  if (uFocusAmt > 0.01 && abs(fd) < uCell * 0.75 && site > 0.5 && th < uFocusAmt) {
    on = 1.0;
    tone = 0.95;
    tint = vec3(1.0);
  }

  gl_FragColor = vec4(mix(uInk, uPaper * tint * clamp(tone, 0.0, 1.0), on), 1.0);
}
`;

const COMPOSE = `
precision highp float;
#define TEXT_DENS 0.94     // text: share of glyph pixels lit
#define TEXT_TONE 0.62     // text tone at rest (labels stay quiet)

${PUSH}

uniform sampler2D uField;
uniform sampler2D uUI;
uniform vec2  uCells;
uniform float uCell;
uniform float uUi;
uniform vec4  uHot;
uniform float uHotAmt;
uniform vec3  uPaper;

void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 cell = floor(px / uCell);
  vec3 col = texture2D(uField, (cell + 0.5) / uCells).rgb;
  vec3 push = pushAt(px + 0.5);
  float t = texture2D(uUI, (px + 0.5 - push.xy) / uDev).r;
  float hot = step(uHot.x, px.x) * step(px.x, uHot.z) * step(uHot.y, px.y) * step(px.y, uHot.w) * uHotAmt;
  float on = step(blue(px + vec2(17.0, 5.0)), t * TEXT_DENS * uUi);
  vec3 tc = uPaper * mix(TEXT_TONE, 1.0, clamp(max(hot, push.z), 0.0, 1.0));
  gl_FragColor = vec4(mix(col, tc, on), 1.0);
}
`;

// ------------------------------------------------------------------ scene elements
// The registry of everything rendered into the dots. Layout stays in the DOM; see README "Adding an element".
const elements = createElements(() => scene?.rebuildUI());
elements.add({ id: "wordmark", kind: "wordmark", node: logoSvg, sticky: true });
elements.add({ id: "labels", kind: "text", node: hero.querySelector(".bar"), density: 1 });
const linksNav = hero.querySelector(".links");
elements.add({ id: "links", kind: "box", node: linksNav, area: true, outline: true, density: 0.6 });
linksNav.querySelectorAll("a").forEach((a, i) => {
  elements.add({ id: `link-${i}`, kind: "box", node: a, outline: true, density: 0.6, hover: true });
  elements.add({ id: `link-${i}-text`, kind: "text", node: a, density: 1 });
});

// ------------------------------------------------------------------ WebGL
function createScene() {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (console.warn(gl.getShaderInfoLog(s)), null);
  };
  const program = (fragSrc) => {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "position");
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  };
  const field = program(FIELD);
  const compose = program(COMPOSE);
  if (!field || !compose) return null;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (unit, filter, wrap) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };

  // unit 0: wordmark · 1: blue noise · 2: UI mask · 3: the field (render target)
  const wm = buildWordmarkTexture();
  texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, wm.tw, wm.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, wm.data);

  texture(1, gl.NEAREST, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());

  const uiTex = texture(2, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const uiCanvas = document.createElement("canvas");

  const fieldTex = texture(3, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();

  const locs = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const common = ["uDev", "uE", "uEV", "uER", "uW[0]", "uTime", "uBlue", "uUI", "uCells", "uCell", "uUi", "uHot", "uHotAmt", "uPaper"];
  const UF = locs(field, [...common, "uIntro", "uLogo", "uTexScale", "uTexOff", "uTexPerCell", "uFlip[0]", "uBlob", "uFocus", "uFocusAmt", "uInk", "uMask"]);
  const UC = locs(compose, [...common, "uField"]);

  gl.useProgram(field);
  gl.uniform1i(UF.uMask, 0);
  gl.uniform1i(UF.uBlue, 1);
  gl.uniform1i(UF.uUI, 2);
  gl.uniform2f(UF.uTexScale, wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(UF.uTexOff, MARGIN / wm.tw, MARGIN / wm.th);
  gl.uniform3fv(UF.uInk, INK);
  gl.uniform3fv(UF.uPaper, PAPER);
  gl.useProgram(compose);
  gl.uniform1i(UC.uBlue, 1);
  gl.uniform1i(UC.uUI, 2);
  gl.uniform1i(UC.uField, 3);
  gl.uniform3fv(UC.uPaper, PAPER);

  // A dither cell is ~1/80 of the wordmark's height, between 1 and 1.5 CSS px and never under 2 device px.
  // The canvas itself runs at device pixels; the field pass runs at one fragment per cell.
  const dpr = window.devicePixelRatio || 1;
  let CELL = 3;
  let cells = [1, 1];
  let dev = [1, 1];
  let hr = hero.getBoundingClientRect();
  let ready = false; // set once everything below exists; until then nothing draws
  const waveData = new Float32Array(16);

  function rebuildUI() {
    rasterise(elements.list, uiCanvas, hero, dpr, CELL / dpr);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, uiTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uiCanvas);
    if (reduce && ready) draw();
  }

  function resize() {
    hr = hero.getBoundingClientRect();
    measureLogo();
    const cssCell = clamp(state.logoCss[3] / 80, 1, 1.5);
    CELL = Math.max(2, Math.round(dpr * cssCell));
    dev = [Math.max(1, Math.round(hr.width * dpr)), Math.max(1, Math.round(hr.height * dpr))];
    cells = [Math.ceil(dev[0] / CELL), Math.ceil(dev[1] / CELL)];
    canvas.width = dev[0];
    canvas.height = dev[1];
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rebuildUI();
  }

  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      resize();
      if (reduce && ready) draw();
    });
  }).observe(hero);
  resize();
  document.fonts?.ready.then(rebuildUI);

  // client px → device px with y up
  const toDev = (x, y) => [(x - hr.left) * dpr, (hr.bottom - y) * dpr];
  const rectDev = (r) => {
    const [x0, y0] = toDev(r.left, r.bottom);
    const [x1, y1] = toDev(r.right, r.top);
    return [x0, y0, x1, y1];
  };

  function setCommon(U) {
    const e = state.e;
    const [ex, ey] = toDev(e.x + hr.left, e.y + hr.top);
    gl.uniform2f(U.uDev, dev[0], dev[1]);
    gl.uniform3f(U.uE, ex, ey, e.str);
    gl.uniform2f(U.uEV, e.vx * dpr, -e.vy * dpr);
    gl.uniform1f(U.uER, ELECTRON_R * dpr);
    gl.uniform4fv(U["uW[0]"], waveData);
    gl.uniform1f(U.uTime, state.time);
    gl.uniform2f(U.uCells, cells[0], cells[1]);
    gl.uniform1f(U.uCell, CELL);
    gl.uniform1f(U.uUi, state.ui);
    gl.uniform4fv(U.uHot, state.hotRect);
    gl.uniform1f(U.uHotAmt, state.hotAmt);
  }

  function draw() {
    // waves → uniforms
    const now = state.time;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = state.waves[i];
      const age = w ? now - w.t0 : -1;
      const [wx, wy] = w ? toDev(w.x + hr.left, w.y + hr.top) : [0, 0];
      waveData.set([wx, wy, w ? age : -1, w ? Math.pow(1 - clamp01(age / WAVE_LIFE), 2) : 0], i * 4);
    }

    // pass 1: the field, one fragment per cell
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, cells[0], cells[1]);
    gl.useProgram(field);
    setCommon(UF);
    const [l, t, w, h] = state.logoCss;
    const [lx, ly] = toDev(l, t + h);
    gl.uniform4f(UF.uLogo, lx / CELL, ly / CELL, (w * dpr) / CELL, (h * dpr) / CELL);
    gl.uniform1f(UF.uTexPerCell, wm.ch / Math.max(1, (h * dpr) / CELL));
    gl.uniform1f(UF.uIntro, state.intro);
    gl.uniform2fv(UF["uFlip[0]"], flipUniform);
    const b = state.blob;
    const [bx, by] = toDev(b.x + hr.left, b.y + hr.top);
    gl.uniform4f(UF.uBlob, bx, by, b.str, b.letter);
    gl.uniform4fv(UF.uFocus, state.focusRect ? rectDev(state.focusRect) : [0, 0, 0, 0]);
    gl.uniform1f(UF.uFocusAmt, state.focusAmt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: compose at device pixels
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dev[0], dev[1]);
    gl.useProgram(compose);
    setCommon(UC);
    // small type only feels a quarter of the electron's push, so a hovered link stays readable
    const [ex, ey] = toDev(state.e.x + hr.left, state.e.y + hr.top);
    gl.uniform3f(UC.uE, ex, ey, state.e.str * 0.25);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  ready = true;

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    html.classList.remove("gl");
  });

  return { draw, rebuildUI, rectDev };
}

// ------------------------------------------------------------------ the electron and the sticky bubble
// State machine (see README): FREE ⇄ STUCK(i).
//   FREE → STUCK(i): the electron comes within ENTER of letter i's edge (and i is re-armed). Letter i flips.
//   STUCK(i): a bubble grows out of i toward the electron, anchored at most MAX_PULL from i.
//     · pulled past MAX_PULL and within ENTER of another letter j → STUCK(j) (capture hands over, j flips)
//     · pulled past MAX_PULL with no letter near → FREE (the neck snaps back)
//     · direction change: the electron travels TURN_BACK back against the direction it was captured in
//       → FREE; it then captures the next letter it reaches in the new direction
//     · the electron leaves (pointer out / finger up) → FREE
//   A released letter re-arms once the electron is REARM × ENTER away from it.
function wordmarkPoint(x, y) {
  // hero CSS px → wordmark units (u across, v up) and the aspect ratio
  const hr = hero.getBoundingClientRect();
  const [l, t, w, h] = state.logoCss;
  return { qx: (x + hr.left - l) / w, qy: (t + h - (y + hr.top)) / h, aspect: w / h, h, w };
}

function distances(x, y) {
  const p = wordmarkPoint(x, y);
  const d = [];
  for (let i = 0; i < LETTERS; i++) d.push(-letterDistance(i, p.qx, p.qy, p.aspect)); // + outside, in h
  return { d, p };
}

function capture(i, now) {
  state.stuck = i;
  state.blob.letter = i;
  state.capDir = Math.abs(state.e.vx) > 30 ? Math.sign(state.e.vx) : 1;
  state.capExtreme = state.capDir * state.e.x;
  state.rearm[i] = false;
  startFlip(i, now);
}

function release() {
  if (state.stuck >= 0) state.rearm[state.stuck] = false;
  state.stuck = -1;
}

function updateSticky(now) {
  if (!wordmarkSD || !flipsArmed) return;
  const e = state.e;
  const { d, p } = distances(e.x, e.y);
  for (let i = 0; i < LETTERS; i++) if (i !== state.stuck && d[i] > ENTER * REARM) state.rearm[i] = true;

  if (!e.on) {
    release();
  } else if (state.stuck < 0) {
    let best = -1;
    for (let i = 0; i < LETTERS; i++) if (state.rearm[i] && d[i] < ENTER && (best < 0 || d[i] < d[best])) best = i;
    if (best >= 0) capture(best, now);
  } else {
    const i = state.stuck;
    state.capExtreme = Math.max(state.capExtreme, state.capDir * e.x);
    const turnedBack = state.capExtreme - state.capDir * e.x > TURN_BACK * p.h;
    if (turnedBack) {
      release();
    } else if (d[i] > MAX_PULL) {
      let next = -1;
      for (let j = 0; j < LETTERS; j++) if (j !== i && d[j] < ENTER && (next < 0 || d[j] < d[next])) next = j;
      if (next >= 0) capture(next, now);
      else release();
    }
  }

  // the bubble's anchor: the electron, or the point MAX_PULL out of the letter toward it
  const b = state.blob;
  let tx = e.x;
  let ty = e.y;
  if (state.stuck >= 0) {
    const i = state.stuck;
    const di = d[i];
    if (di > MAX_PULL) {
      // step back toward the letter along the distance gradient
      const eps = 0.02 * p.h;
      const dx = distances(e.x + eps, e.y).d[i] - distances(e.x - eps, e.y).d[i];
      const dy = distances(e.x, e.y + eps).d[i] - distances(e.x, e.y - eps).d[i];
      const gl = Math.hypot(dx, dy) || 1;
      const back = (di - MAX_PULL) * p.h;
      tx = e.x - (dx / gl) * back;
      ty = e.y - (dy / gl) * back;
    }
  }
  return { tx, ty };
}

// one semi-implicit step of a damped spring: o[k] moves toward target, o[v] is its velocity.
// [ω, ζ]: ζ = 1 is critically damped (fastest without overshoot), below 1 it swings a little past.
// Sub-stepped at ≤ 8 ms so stiff springs stay stable at 30 fps (and after a dropped frame).
function spring(o, k, v, target, [w, z], dt) {
  const n = Math.ceil(dt / 0.008);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    o[v] += (w * w * (target - o[k]) - 2 * z * w * o[v]) * h;
    o[k] += o[v] * h;
  }
  if (!Number.isFinite(o[k])) {
    o[k] = target;
    o[v] = 0;
  }
}

// ------------------------------------------------------------------ pointer, clicks, focus
function setTarget(e) {
  const r = hero.getBoundingClientRect();
  const st = state.e;
  st.tx = e.clientX - r.left;
  st.ty = e.clientY - r.top;
  if (!st.on) {
    // a new electron appears where the pointer is, without sweeping in from far away
    st.x = st.tx;
    st.y = st.ty;
    st.vx = st.vy = 0;
    state.blob.x = st.x;
    state.blob.y = st.y;
  }
  st.on = true;
}

window.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType === "touch" && e.buttons === 0) return;
    setTarget(e);
    if (!scene) fallbackFlip(e, false);
    updateHover(e.clientX, e.clientY);
  },
  { passive: true }
);
window.addEventListener(
  "pointerdown",
  (e) => {
    setTarget(e);
    if (!scene) return fallbackFlip(e, true);
    updateHover(e.clientX, e.clientY);
    if (reduce || e.target.closest("a")) return;
    // a click on the background (not a link, not inside a letter) sends a wave across the screen
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (wordmarkSD && Math.min(...distances(x, y).d) < 0) return;
    state.waves.push({ x, y, t0: state.time });
    if (state.waves.length > MAX_WAVES) state.waves.shift();
  },
  { passive: true }
);
const electronOff = (e) => {
  if (e.type === "pointerleave" || e.pointerType === "touch") state.e.on = false;
};
window.addEventListener("pointerup", electronOff, { passive: true });
window.addEventListener("pointercancel", electronOff, { passive: true });
html.addEventListener("pointerleave", electronOff);

let hoverList = [];
function updateHover(x, y) {
  if (!scene) return;
  const hit = hoverList.find(({ rect: r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  if (hit && hit !== state.hot) state.hotRect = scene.rectDev(hit.rect);
  state.hot = hit || null;
  if (reduce) {
    state.hotAmt = hit ? 1 : 0;
    scene.draw();
  }
}
function refreshTargets() {
  hoverList = hoverTargets(elements.list);
}

document.addEventListener("focusin", (e) => {
  const a = e.target.closest?.(".links a");
  state.focusRect = a && a.matches(":focus-visible") ? a.getBoundingClientRect() : null;
  if (reduce) {
    state.focusAmt = state.focusRect ? 1 : 0;
    scene?.draw();
  }
});
document.addEventListener("focusout", () => {
  state.focusRect = null;
  if (reduce) {
    state.focusAmt = 0;
    scene?.draw();
  }
});

// ------------------------------------------------------------------ loop
const scene = createScene();
if (scene) html.classList.add("gl");

measureLogo();
refreshTargets();
new ResizeObserver(() => {
  measureLogo();
  refreshTargets();
}).observe(hero);

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
  const dt = Math.min(dtMs, 50) / 1000;
  state.time = (now - t0) / 1000;

  const e = state.e;
  spring(e, "x", "vx", e.tx, ELECTRON_SPRING, dt);
  spring(e, "y", "vy", e.ty, ELECTRON_SPRING, dt);
  spring(e, "str", "sv", e.on ? 1 : 0, [14, 1], dt);
  e.str = clamp01(e.str);

  updateFlips(now);
  const { tx, ty } = updateSticky(now) || { tx: e.x, ty: e.y };
  const b = state.blob;
  spring(b, "x", "vx", tx, BUBBLE_SPRING, dt);
  spring(b, "y", "vy", ty, BUBBLE_SPRING, dt);
  spring(b, "str", "sv", state.stuck >= 0 ? 1 : 0, [state.stuck >= 0 ? 11 : 16, 1], dt);
  b.str = clamp01(b.str);

  const k = 1 - Math.exp(-dt * 12);
  state.hotAmt += k * ((state.hot ? 1 : 0) - state.hotAmt);
  state.focusAmt += k * ((state.focusRect ? 1 : 0) - state.focusAmt);
  state.waves = state.waves.filter((w) => state.time - w.t0 < WAVE_LIFE);

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
    if (scene) {
      await document.fonts?.ready;
      scene.rebuildUI();
      scene.draw();
    } else flipSvg();
    return;
  }

  requestAnimationFrame(frame);
  const uiIn = () => tween(900, (t) => (state.ui = t));

  if (seen && !forced) {
    // returning visitor: skip the console, keep the entrance
    html.classList.add("quick");
    await tween(1600, (t) => (state.intro = t));
    html.classList.remove("booting");
    html.classList.add("ready");
    flipsArmed = true;
    await uiIn();
    return;
  }

  const count = hero.querySelector("[data-count]");
  const bar = hero.querySelector("[data-bar]");
  const lines = [...hero.querySelectorAll(".boot__log li")];
  lines.forEach((li, i) => setTimeout(() => li.classList.add("on"), 250 + i * 380));

  // the counter runs; as it nears 100 the field fills in and the letters dissolve into view
  const counter = tween(2000, (t) => {
    const e = easeInOutCubic(t);
    count.textContent = String(Math.round(e * 100)).padStart(3, "0");
    bar.style.transform = `scaleX(${e})`;
  });
  const entrance = wait(1450).then(() => tween(2100, (t) => (state.intro = t)));

  await counter;
  html.classList.add("boot-done");
  await Promise.all([entrance, wait(260)]);
  html.classList.remove("booting");
  html.classList.add("ready");
  flipsArmed = true;
  try {
    sessionStorage.setItem("cc-boot", "1");
  } catch {
    /* storage unavailable: the boot simply plays again next time */
  }
  await uiIn();
}

boot();
