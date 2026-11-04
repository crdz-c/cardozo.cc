// cardozo.cc hero — one canvas of dots. Every element of the interface (the CRDZC wordmark and the links)
// is rendered *into* a single dithered dot field; the pointer is an "electron" that pushes that field
// around; letters flip when it enters them; a click on the background sends a wave across the screen.
// No dependencies. Everything degrades: no JS → static page; no WebGL → the SVG wordmark and the DOM
// links; prefers-reduced-motion → one still frame (still in dots), no boot, no flips, no waves.

import { distanceTransform, roundCorners, blueNoise } from "./raster.js";
import { BRANDS } from "./brands.js";

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
const ELECTRON_R = 32; // CSS px: radius of the electron's push
const ELECTRON_SPRING = [26, 1]; // critically damped: fluid but precise, never overshoots
const AFTERGLOW = 2.8; // s: decay time of the field's stirred-up energy
const MAX_SPEED = 2400; // CSS px/s: cap on the speed the field's deflection and wake respond to
const FLIP_EVERY = [4000, 6000]; // ms between a letter's flips (each letter on its own timer)
const FLIP_FIRST = [1500, 5000]; // ms before a letter's first flip, so they never flip together
const FLIP_DUR = [760, 980]; // ms per flip
const POSTPONE = 700; // ms a due flip waits while its letter is hovered or focused
const WAVE_LIFE = 4.6; // s: a wave's whole life (slow decay)
const MAX_WAVES = 6;

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : the field fills in and the letters dissolve into view
  time: reduce ? 6 : 0,
  logoCss: [0, 0, 1, 1], // left, top, w, h of the wordmark (client px)
  // the electron, in hero CSS px
  e: { x: -1e4, y: -1e4, vx: 0, vy: 0, tx: -1e4, ty: -1e4, on: false, str: 0, sv: 0 },
  energy: 0, // stirred-up energy of the field (0..1), decays over AFTERGLOW
  stir: [0, 0], // where it was last stirred, hero CSS px
  focusRect: null,
  focusLetter: -1, // letter-link with keyboard focus
  focusAmt: 0,
  waves: [], // { x, y, t0 } in hero CSS px, seconds
};

// ------------------------------------------------------------------ letters: links with two faces
// Each letter is a link (an SVG <a> in index.html) and has two faces: the letter and the brand mark of its link.
// Every letter flips on its own timer (FLIP_EVERY, first one after FLIP_FIRST), horizontally or vertically at
// random, around its own centre; at the edge-on midpoint the face swaps and the dots scatter and regather into
// the other shape. Brand faces are always upright. The letter face keeps a mirror state: random on every load,
// and each time the letter face turns back in, the flipped axis toggles it. A letter never flips while it is
// hovered or focused (its timer waits), so a click never lands on a moving target.
const LETTERS = 5;
const LETTER_EDGES = [-1, 18.55 / 90, 36.15 / 90, 54.75 / 90, 71.15 / 90, 2]; // gap midpoints, in u
const LETTER_CENTERS = [8.9 / 90, 27.35 / 90, 45.45 / 90, 62.95 / 90, 80.8 / 90];
// C and D look identical flipped vertically, so they lean horizontal; R and Z are fair game
const HORIZONTAL_BIAS = [0.8, 0.5, 0.8, 0.5, 0.8];
const links = [...logoSvg.querySelectorAll(".ln")];
const letterGroups = links.map((a) => a.querySelector(".lt"));
// which brand mark each letter turns into, read from its link (reorder the links in index.html to remap)
const brandOf = (href) =>
  href.startsWith("mailto:") ? "email"
  : /linkedin\./.test(href) ? "linkedin"
  : /github\./.test(href) ? "github"
  : /medium\./.test(href) ? "medium"
  : /dribbble\./.test(href) ? "dribbble"
  : "email";
const LETTER_BRANDS = links.map((a) => brandOf(a.getAttribute("href")));

const flipUniform = new Float32Array(LETTERS * 2).fill(1); // per letter: horizontal / vertical scale (signed)
const faceUniform = new Float32Array(LETTERS * 2); // per letter: face shown (0 letter, 1 brand), morph 0..1
const flips = Array.from({ length: LETTERS }, () => ({
  mx: Math.random() < 0.5 ? 1 : -1, // the letter face's mirror state
  my: Math.random() < 0.5 ? 1 : -1,
  face: 0, // 0 letter, 1 brand
  axis: "x",
  flipping: false,
  t0: 0,
  dur: 0,
  nextAt: Infinity, // set when the boot is over
}));
let flipsArmed = false;
const held = new Set(); // letters under the pointer or with keyboard focus: their timers wait

flips.forEach((f, i) => {
  flipUniform[i * 2] = f.mx;
  flipUniform[i * 2 + 1] = f.my;
});

function armFlips(now) {
  flipsArmed = true;
  if (reduce) return;
  flips.forEach((f) => (f.nextAt = now + rand(...FLIP_FIRST)));
}

function startFlip(i, now) {
  const f = flips[i];
  if (f.flipping || reduce) return;
  f.axis = Math.random() < HORIZONTAL_BIAS[i] ? "x" : "y";
  f.flipping = true;
  f.t0 = now;
  f.dur = rand(...FLIP_DUR);
}

function updateFlips(now) {
  flips.forEach((f, i) => {
    if (!f.flipping && now >= f.nextAt) {
      if (held.has(i)) f.nextAt = now + POSTPONE;
      else startFlip(i, now);
    }
    let sx = f.face ? 1 : f.mx;
    let sy = f.face ? 1 : f.my;
    let face = f.face;
    let morph = 0;
    if (f.flipping) {
      const t = clamp01((now - f.t0) / f.dur);
      // quart in-out: leaves slowly, passes edge-on quickly, settles softly, never grows past its size
      const c = Math.cos(Math.PI * easeInOutQuart(t));
      const second = c < 0; // past edge-on: the other face, coming in
      face = second ? 1 - f.face : f.face;
      morph = 1 - Math.abs(c);
      // the letter face carries its mirror (toggled on the flipped axis when it comes back); brands stay upright
      let mx = 1;
      let my = 1;
      if (face === 0) {
        mx = f.mx;
        my = f.my;
        if (second) {
          if (f.axis === "x") mx = -mx;
          else my = -my;
        }
      }
      const k = Math.abs(c);
      sx = f.axis === "x" ? mx * k : mx;
      sy = f.axis === "y" ? my * k : my;
      if (t >= 1) {
        if (f.face === 1) {
          // the letter comes back: its mirror toggles on the axis it turned around
          if (f.axis === "x") f.mx *= -1;
          else f.my *= -1;
        }
        f.face = 1 - f.face;
        face = f.face;
        sx = face ? 1 : f.mx;
        sy = face ? 1 : f.my;
        morph = 0;
        f.flipping = false;
        f.nextAt = now + rand(...FLIP_EVERY);
      }
    }
    flipUniform[i * 2] = sx;
    flipUniform[i * 2 + 1] = sy;
    faceUniform[i * 2] = face;
    faceUniform[i * 2 + 1] = morph;
  });
  if (!scene) flipSvg();
}

// no-WebGL fallback: the SVG follows the same faces and flips (letter group or brand mark, scaled)
let brandGroups = [];
function makeBrandGroups() {
  brandGroups = links.map((a, i) => {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "bf");
  g.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const b = BRANDS[LETTER_BRANDS[i]];
  const [x, y, size] = brandBox(i);
  p.setAttribute("d", b.d);
  p.setAttribute("class", "brand");
  if (b.evenodd) p.setAttribute("fill-rule", "evenodd");
  // the placement goes on its own <g>: `.logo path` sets a transform box/origin meant for the letters
  const place = document.createElementNS("http://www.w3.org/2000/svg", "g");
  place.setAttribute("transform", `translate(${x} ${y}) scale(${size / 24})`);
  place.appendChild(p);
  g.appendChild(place);
  a.appendChild(g);
  return g;
  });
}
function flipSvg() {
  flips.forEach((f, i) => {
    const sx = flipUniform[i * 2] || 0.001;
    const sy = flipUniform[i * 2 + 1] || 0.001;
    const face = faceUniform[i * 2];
    letterGroups[i].style.transform = face ? "scale(0.001)" : `scale(${sx}, ${sy})`;
    brandGroups[i].style.transform = face ? `scale(${sx}, ${sy})` : "scale(0.001)";
    brandGroups[i].querySelector(".brand").style.display = face ? "inline" : "none";
  });
}

function measureLogo() {
  const r = logoSvg.getBoundingClientRect();
  state.logoCss = [r.left, r.top, r.width, r.height];
}

// pointer / keyboard on a letter-link: its timer waits (no flip under a click); keyboard focus is drawn as a
// dotted underline. Hover itself has no special effect: the electron does what it does everywhere.
links.forEach((a, i) => {
  a.addEventListener("pointerenter", () => held.add(i));
  a.addEventListener("pointerleave", () => state.focusLetter !== i && held.delete(i));
  a.addEventListener("focus", () => {
    held.add(i);
    state.focusLetter = a.matches(":focus-visible") ? i : -1;
    state.focusRect = state.focusLetter >= 0 ? a.querySelector(".hit").getBoundingClientRect() : null;
    if (reduce) {
      state.focusAmt = state.focusRect ? 1 : 0;
      scene?.draw();
    }
  });
  a.addEventListener("blur", () => {
    held.delete(i);
    state.focusLetter = -1;
    state.focusRect = null;
    if (reduce) {
      state.focusAmt = 0;
      scene?.draw();
    }
  });
});

// ------------------------------------------------------------------ wordmark texture
// The SVG paths are rasterised once, their corners rounded, and per texel we store:
//   R coverage · G distance to the edge inside a letter · B closeness to a letter outside it.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const TEX_H = VBH * TEXELS_PER_UNIT; // texels per wordmark height
const HALO = 170; // texels: range of the outside distance (soft edges)
const MARGIN = HALO + 10; // transparent border so outside distances fit and sampling past the edge reads 0
const DEPTH = 55; // texels: range of the inside distance
const ROUND_OPEN = 17; // texels (≈ 4.9% of the letter height): radius of the outer corners
const ROUND_CLOSE = 9; // texels (≈ 2.6%): radius of the inner corners
const BRAND_SIZE = 14; // viewBox units: each brand mark's square, centred on its letter (letters are ~16 × 15.75)
const BRAND_ROUND = [4, 3]; // texels: a light rounding for the brand marks (they have thin strokes)

// where letter i's brand mark sits, in viewBox units: [x, y, size]
function brandBox(i) {
  return [LETTER_CENTERS[i] * VBW - BRAND_SIZE / 2, VBH / 2 - BRAND_SIZE / 2, BRAND_SIZE];
}

// Rasterise shapes (drawn by `draw(ctx)` in viewBox units) into the texture layout both faces share:
//   R coverage · G distance to the edge inside · B closeness to a shape outside. Corners are rounded first.
function buildMaskTexture(draw, rOpen, rClose) {
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
  draw(ctx);

  const rgba = ctx.getImageData(0, 0, tw, th).data;
  const n = tw * th;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = rgba[i * 4] > 127 ? 1 : 0;
  const solid = roundCorners(raw, tw, th, rOpen, rClose);
  const inside = distanceTransform(solid, tw, th, 0);
  const outside = distanceTransform(solid, tw, th, 1);

  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = solid[i] * 255;
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / DEPTH) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / HALO) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, tw, th, cw, ch };
}

// the letter face: the wordmark's own paths
const buildWordmarkTexture = () =>
  buildMaskTexture((ctx) => logoSvg.querySelectorAll(".lt path").forEach((p) => ctx.fill(new Path2D(p.getAttribute("d")))), ROUND_OPEN, ROUND_CLOSE);

// the brand face: each letter's brand mark, upright, in the same place as its letter
const buildBrandTexture = () =>
  buildMaskTexture(
    (ctx) =>
      LETTER_BRANDS.forEach((key, i) => {
        const [x, y, size] = brandBox(i);
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(size / 24, size / 24);
        ctx.fill(new Path2D(BRANDS[key].d), BRANDS[key].evenodd ? "evenodd" : "nonzero");
        ctx.restore();
      }),
    ...BRAND_ROUND
  );

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
uniform vec4  uW[6];      // waves: x, y (device px), age (s, < 0 = off), amplitude
uniform float uTime;
uniform sampler2D uBlue;

#define PUSH_AMT 0.6       // radial push, × electron radius
#define DEFLECT 0.35       // sideways deflection at speed, × electron radius
#define RING 0.75          // density piled up where the pushed field compresses
#define THIN 0.6           // density cleared inside the electron's reach (around its core)
#define WAKE 0.5           // density in the short wake behind a moving electron
#define WAVE_SPEED 0.55    // screen heights per second (passes the farthest corner within its life)
#define WAVE_WIDTH 0.06    // screen heights: the ring's half-width
#define WAVE_PUSH 0.016    // screen heights: how far the ring displaces the dots
#define WAVE_DENS 0.8      // density/brightness swell at the front
#define WAVE_ECHO 0.45     // first trailing echo (pushes the other way), × the front
#define WAVE_ECHO2 0.2     // second trailing echo
#define WAVE_GAP 2.6       // spacing of the echoes, in ring half-widths

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
  o.z -= uE.z * THIN * exp(-pow(r / (0.8 * R), 2.0)); // pushed out: thinner inside, bunched at the rim
  if (sp > 1.0) {
    vec2 tail = uE.xy - uEV * 0.07;
    o.z += uE.z * WAKE * fast * exp(-dot(p - tail, p - tail) / (R * R * 1.4));
  }
  for (int i = 0; i < 6; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    vec2 dw = p - w.xy;
    float rw = length(dw) + 0.001;
    float front = w.z * WAVE_SPEED * uDev.y;
    float x = (rw - front) / (WAVE_WIDTH * uDev.y);
    // a ripple: the front pushes out, the echoes behind it pull back in, each softer than the last
    float r0 = exp(-x * x);
    float r1 = WAVE_ECHO * exp(-pow(x + WAVE_GAP, 2.0));
    float r2 = WAVE_ECHO2 * exp(-pow(x + 2.0 * WAVE_GAP, 2.0));
    o.xy += dw / rw * (r0 - r1 + r2) * w.w * WAVE_PUSH * uDev.y;
    o.z += (r0 + r1 + r2) * w.w * WAVE_DENS;
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
#define MORPH_THIN 0.7     // how much the shape thins out around the face swap
#define MORPH_CLOUD 0.55   // how dense the cloud of dots in flight gets at the swap
#define EDGE_HOVER 0.3     // … × this right around the electron (crisper there)
#define EDGE_NOISE 2.2     // roughness of that ramp, in cells
#define TONE_L 0.97        // letter dot tone
#define TWINKLE 0.3        // per-dot twinkle depth (letters at 35% of it)
#define FIELD_TINT vec3(0.9, 0.94, 1.0)
#define SEA_AMP 0.9        // calm-sea drift at rest, cells
#define SEA_STIR 4.0       // extra drift near the last interaction, × energy, cells
#define SEA_GLOBAL 1.2     // extra drift everywhere, × energy, cells
#define SEA_SCALE 0.3      // swell size, screen heights
#define SEA_SPEED 0.05     // swell speed
#define SEA_RIPPLE 0.07    // ripple frequency, per cell (≈ 14-cell clusters)
#define CORE 0.32          // electron core radius, × electron radius
#define LINE_TONE 0.5      // UI shapes (borders)

${PUSH}

uniform vec2  uCells;     // field size, in cells
uniform float uCell;      // device px per cell
uniform float uIntro;
uniform vec4  uLogo;      // x, y (bottom-left), w, h of the wordmark, in cells
uniform vec2  uTexScale;
uniform vec2  uTexOff;
uniform float uTexPerCell;
uniform vec2  uFlip[5];
uniform vec2  uFace[5];   // per letter: face shown (0 letter, 1 brand mark), morph 0..1 (around the swap)
uniform sampler2D uBrand;
uniform vec3  uSea;       // calm-sea drift: amplitude (cells), stir x, y (device px)
uniform float uEnergy;    // stirred-up energy 0..1 (afterglow)
uniform vec4  uFocus;     // keyboard-focused UI element, device px
uniform float uFocusAmt;
uniform vec3  uInk;
uniform vec3  uPaper;
uniform sampler2D uMask;

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
  for (int i = 0; i < 6; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    float front = w.z * WAVE_SPEED * uDev.y;
    float wx = (length(pd - w.xy) - front) / (WAVE_WIDTH * uDev.y) + WAVE_GAP;
    k = max(k, w.w * exp(-pow(wx / (WAVE_GAP + 2.0), 2.0))); // the front and its echoes
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
vec2 faceFor(float li) {
  vec2 f = vec2(0.0);
  for (int i = 0; i < 5; i++) {
    if (abs(float(i) - li) < 0.5) f = uFace[i];
  }
  return f;
}
// both faces share one texture layout: the letter (uMask) or its brand mark (uBrand), in the same place
vec4 maskAt(vec2 tc, float brand) {
  float inside = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
  return (brand > 0.5 ? texture2D(uBrand, tc) : texture2D(uMask, tc)) * inside;
}
// signed distance (cells, + inside) to letter li as currently flipped; it keeps growing outside the
// letter's column, so a squeezed (flipping) letter never picks up its neighbour's shape
float letterSD(float li, vec2 q, float aspect) {
  vec2 fs = flipFor(li);
  float cu = letterCenter(li);
  vec2 qf = vec2(cu + (q.x - cu) / fs.x, 0.5 + (q.y - 0.5) / fs.y);
  vec2 b = letterBounds(li);
  vec2 qc = vec2(clamp(qf.x, b.x, b.y), clamp(qf.y, -0.45, 1.45));
  float extra = length((qf - qc) * vec2(aspect, 1.0)) * uLogo.w;
  vec4 t = maskAt(qc * uTexScale + uTexOff, faceFor(li).x);
  float tpc = uTexPerCell / max(min(abs(fs.x), abs(fs.y)), 0.15);
  return (t.r > 0.5 ? t.g * DEPTH_TX : -(1.0 - t.b) * HALO_TX) / tpc - extra;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 pDev = (cell + 0.5) * uCell;
  vec3 push = pushAt(pDev);
  vec2 c = (pDev - push.xy) / uCell; // where this cell samples the scene from (displaced), in cells

  // calm sea: a slow, low-frequency swell of the field. Stirred-up energy (afterglow) makes it larger and
  // livelier, most around where the interaction happened, then it settles back. The UI never drifts and
  // the letters only a little while the energy lasts.
  vec2 sp = c / (SEA_SCALE * uCells.y);
  vec2 sea = vec2(vnoise(vec3(sp, uTime * SEA_SPEED)), vnoise(vec3(sp + 7.7, uTime * SEA_SPEED + 3.1))) - 0.5;
  vec2 chop = vec2(vnoise(vec3(sp * 2.6, uTime * 0.3)), vnoise(vec3(sp * 2.6 + 4.2, uTime * 0.3 + 1.9))) - 0.5;
  float stirW = exp(-pow(length(pDev - uSea.yz) / (0.45 * uDev.y), 2.0));
  float stirAmp = uEnergy * (SEA_STIR * stirW + SEA_GLOBAL);
  vec2 seaOff = uSea.x * (sea * 2.0 * (SEA_AMP + stirAmp) + chop * 2.0 * stirAmp * 0.6);
  vec2 cs = c + seaOff;                    // the field and the cloud
  vec2 cL = c + seaOff * 0.3 * uEnergy;    // the letters
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
      D = densityAt(cs);
    }
  }

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
    float present = step(hb, (0.45 + 1.4 * D) * smoothstep(0.0, 0.7, uIntro));
    on = isDot * present;
    tone = (0.2 + 0.12 * D) * (1.0 - TWINKLE * tw);
  } else {
    // ---- fine field: the wordmark and the cloud around it
    vec2 q = (cL - uLogo.xy) / uLogo.zw;
    float aspect = uLogo.z / uLogo.w;
    float li = letterIndex(q.x);
    vec2 fs = flipFor(li);

    // entrance: each letter dissolves in, one after the other, drifting up a little
    float e = clamp(uIntro * 1.6 - li * 0.12, 0.0, 1.0);
    float eo = 1.0 - pow(1.0 - e, 3.0);
    vec2 qr = q - vec2(0.0, 0.18 * (1.0 - eo));

    float sd = letterSD(li, qr, aspect);

    vec2 pc = (cs - (uLogo.xy + 0.5 * uLogo.zw)) / uCells.y;
    float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
    float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;

    // one material: a letter is only where the same dots gather and burn brighter. Its boundary is a wide
    // density ramp roughened by noise (dots stray out, gaps open in), crisper right around the electron.
    float rough = (vnoise(vec3(c * 0.3, uTime * 0.25)) - 0.5) * EDGE_NOISE;
    float soft = EDGE_SOFT * mix(1.0, EDGE_HOVER, eNear);
    float letter = smoothstep(-soft, soft, sd + rough * mix(1.0, 0.4, eNear)) * smoothstep(0.0, 1.0, eo * 1.1);

    // the transformation: around the face swap the shape's dots scatter through the letter's box and regather
    // into the other face (same dots, same grain: no cross-fade)
    float mph = faceFor(li).y;
    if (mph > 0.001) {
      vec2 bnd = letterBounds(li);
      float inCol = step(bnd.x, q.x) * step(q.x, bnd.y) * smoothstep(-0.15, 0.05, q.y) * (1.0 - smoothstep(0.95, 1.15, q.y));
      float scatter = hash2(cell + floor(uTime * 12.0)); // re-rolled a dozen times a second: the dots in flight
      letter = max(letter * (1.0 - MORPH_THIN * mph), inCol * mph * MORPH_CLOUD * step(scatter, 0.55 + 0.45 * mph));
    }

    // ripples: clusters of ~14 cells carried by the sea, so the dots visibly gather and drift
    float rip = vnoise(vec3(cs * SEA_RIPPLE, uTime * 0.12));
    float ripple = mix(1.0, 0.35 + 1.3 * rip, clamp(0.6 + 0.6 * uEnergy, 0.0, 1.0));
    float lumC = ((0.03 + 0.1 * nz * nz) * (1.0 + 0.6 * wave) * ripple + push.z * 0.35) * smoothstep(0.0, 0.7, uIntro);
    float edgeOn = abs(fs.x * fs.y);
    float lumL = (DENS_L + 0.5 * wave * DENS_WAVE + DENS_E * eNear + push.z * 0.3) * (0.55 + 0.45 * edgeOn);
    float lum = mix(lumC * 1.4, lumL, letter);
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

  // keyboard focus: a dotted underline under the focused word
  float under = step(uFocus.x, pDev.x) * step(pDev.x, uFocus.z) * step(abs(pDev.y - (uFocus.y - 3.0 * uCell)), uCell * 0.75);
  if (uFocusAmt > 0.01 && under * site > 0.5 && th < uFocusAmt) {
    on = 1.0;
    tone = 0.95;
    tint = vec3(1.0);
  }

  gl_FragColor = vec4(mix(uInk, uPaper * tint * clamp(tone, 0.0, 1.0), on), 1.0);
}
`;

const COMPOSE = `
precision highp float;
uniform sampler2D uField;
uniform vec2  uCells;
uniform float uCell;
void main() {
  vec2 cell = floor(floor(gl_FragCoord.xy) / uCell);
  gl_FragColor = vec4(texture2D(uField, (cell + 0.5) / uCells).rgb, 1.0);
}
`;

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

  // unit 0: wordmark (letter faces) · 1: blue noise · 3: the field (render target) · 4: brand faces
  const wm = buildWordmarkTexture();
  texture(0, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, wm.tw, wm.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, wm.data);
  const br = buildBrandTexture();
  texture(4, gl.LINEAR, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, br.tw, br.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, br.data);

  texture(1, gl.NEAREST, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());


  const fieldTex = texture(3, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();

  const locs = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const UF = locs(field, ["uDev", "uE", "uEV", "uER", "uW[0]", "uTime", "uBlue", "uCells", "uCell", "uPaper", "uIntro", "uLogo", "uTexScale", "uTexOff", "uTexPerCell", "uFlip[0]", "uFace[0]", "uBrand", "uSea", "uEnergy", "uFocus", "uFocusAmt", "uInk", "uMask"]);
  const UC = locs(compose, ["uField", "uCells", "uCell"]);

  gl.useProgram(field);
  gl.uniform1i(UF.uMask, 0);
  gl.uniform1i(UF.uBrand, 4);
  gl.uniform1i(UF.uBlue, 1);
  gl.uniform2f(UF.uTexScale, wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(UF.uTexOff, MARGIN / wm.tw, MARGIN / wm.th);
  gl.uniform3fv(UF.uInk, INK);
  gl.uniform3fv(UF.uPaper, PAPER);
  gl.useProgram(compose);
  gl.uniform1i(UC.uField, 3);

  // A dither cell is ~1/80 of the wordmark's height, between 1 and 1.5 CSS px and never under 2 device px.
  // The canvas itself runs at device pixels; the field pass runs at one fragment per cell.
  const dpr = window.devicePixelRatio || 1;
  let CELL = 3;
  let cells = [1, 1];
  let dev = [1, 1];
  let hr = hero.getBoundingClientRect();
  let ready = false; // set once everything below exists; until then nothing draws
  const waveData = new Float32Array(MAX_WAVES * 4);

  function resize() {
    hr = hero.getBoundingClientRect();
    measureLogo();
    const cssCell = clamp(state.logoCss[3] / 80, 1, 1.5);
    CELL = Math.max(2, Math.round(dpr * cssCell));
    dev = [Math.max(1, Math.round(hr.width * dpr)), Math.max(1, Math.round(hr.height * dpr))];
    cells = [Math.ceil(dev[0] / CELL), Math.ceil(dev[1] / CELL)];
    canvas.width = dev[0];
    canvas.height = dev[1];
    // the DOM text reserves exactly the dot font's room: one character = 6 font dots, 2 cells each
    html.style.setProperty("--dot", `${(2 * CELL) / dpr}px`);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    // speed-dependent terms see at most MAX_SPEED, so a flick can never smear the field
    const sp = Math.hypot(e.vx, e.vy);
    const k = sp > MAX_SPEED ? MAX_SPEED / sp : 1;
    gl.uniform2f(U.uEV, e.vx * k * dpr, -e.vy * k * dpr);
    gl.uniform1f(U.uER, ELECTRON_R * dpr);
    gl.uniform4fv(U["uW[0]"], waveData);
    gl.uniform1f(U.uTime, state.time);
    gl.uniform2f(U.uCells, cells[0], cells[1]);
    gl.uniform1f(U.uCell, CELL);
  }

  function draw() {
    hr = hero.getBoundingClientRect();
    measureLogo();
    // waves → uniforms
    const now = state.time;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = state.waves[i];
      const age = w ? now - w.t0 : -1;
      const [wx, wy] = w ? toDev(w.x + hr.left, w.y + hr.top) : [0, 0];
      waveData.set([wx, wy, w ? age : -1, w ? Math.pow(1 - clamp01(age / WAVE_LIFE), 1.4) * clamp01(age / 0.25) : 0], i * 4);
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
    gl.uniform2fv(UF["uFace[0]"], faceUniform);
    const [sx, sy] = toDev(state.stir[0] + hr.left, state.stir[1] + hr.top);
    gl.uniform3f(UF.uSea, reduce ? 0 : 1, sx, sy);
    gl.uniform1f(UF.uEnergy, state.energy);
    gl.uniform4fv(UF.uFocus, state.focusRect ? rectDev(state.focusRect) : [0, 0, 0, 0]);
    gl.uniform1f(UF.uFocusAmt, state.focusAmt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: compose at device pixels
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dev[0], dev[1]);
    gl.useProgram(compose);
    gl.uniform2f(UC.uCells, cells[0], cells[1]);
    gl.uniform1f(UC.uCell, CELL);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  ready = true;

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    html.classList.remove("gl");
  });

  // debug only: the field as rendered (one pixel per cell), cropped to a client-px rect, scaled up `zoom`×
  function cropCells(x, y, w, h, zoom = 3) {
    draw();
    const c0 = Math.floor(((x - hr.left) * dpr) / CELL);
    const r1 = Math.floor(((hr.bottom - y) * dpr) / CELL);
    const cw = Math.ceil((w * dpr) / CELL);
    const ch = Math.ceil((h * dpr) / CELL);
    const r0 = Math.max(0, r1 - ch);
    const px = new Uint8Array(cw * ch * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(c0, r0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = document.createElement("canvas");
    out.width = cw * zoom;
    out.height = ch * zoom;
    const o = out.getContext("2d");
    const img = o.createImageData(cw, ch);
    for (let row = 0; row < ch; row++) img.data.set(px.subarray((ch - 1 - row) * cw * 4, (ch - row) * cw * 4), row * cw * 4);
    const tmp = document.createElement("canvas");
    tmp.width = cw;
    tmp.height = ch;
    tmp.getContext("2d").putImageData(img, 0, 0);
    o.imageSmoothingEnabled = false;
    o.drawImage(tmp, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  return { draw, rectDev, cropCells };
}

// One semi-implicit step of a damped spring: o[k] moves toward target, o[v] is its velocity. [ω, ζ]: ζ = 1 is
// critically damped. Sub-stepped at ≤ 8 ms so it stays stable at 30 fps and after a dropped frame.
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
  }
  st.on = true;
}

window.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType === "touch" && e.buttons === 0) return;
    setTarget(e);
  },
  { passive: true }
);
window.addEventListener(
  "pointerdown",
  (e) => {
    setTarget(e);
    if (!scene) return;
    // a click on a letter is its link (the browser follows it); anywhere else sends a wave across the screen
    if (reduce || e.target.closest?.("a")) return;
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    state.waves.push({ x, y, t0: state.time });
    state.energy = Math.max(state.energy, 0.85);
    state.stir = [x, y];
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


// ------------------------------------------------------------------ loop
makeBrandGroups();
const scene = createScene();
if (scene) html.classList.add("gl");

measureLogo();
new ResizeObserver(measureLogo).observe(hero);

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

  // the field's energy: stirred by a moving electron and by waves; it dies down slowly
  const speed = Math.min(Math.hypot(e.vx, e.vy), MAX_SPEED);
  const stirNow = e.str * (speed / MAX_SPEED);
  if (stirNow > state.energy * 0.5) state.stir = [e.x, e.y];
  state.energy = Math.min(1, state.energy * Math.exp(-dt / AFTERGLOW) + stirNow * dt * 2.2);

  const k = 1 - Math.exp(-dt * 12);
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
      scene.draw();
      // one still frame, drawn again once layout and the page have fully settled
      [120, 600, 1500].forEach((ms) => setTimeout(() => scene.draw(), ms));
      const again = () => scene.draw();
      addEventListener("pageshow", again);
      document.addEventListener("visibilitychange", again);
      addEventListener("pointermove", again, { once: true });
    } else flipSvg();
    return;
  }

  requestAnimationFrame(frame);

  if (seen && !forced) {
    // returning visitor: skip the console, keep the entrance
    html.classList.add("quick");
    await tween(1600, (t) => (state.intro = t));
    html.classList.remove("booting");
    html.classList.add("ready");
    armFlips(performance.now());
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
  armFlips(performance.now());
  try {
    sessionStorage.setItem("cc-boot", "1");
  } catch {
    /* storage unavailable: the boot simply plays again next time */
  }
}

boot();

// ?debug exposes the live state and a field crop for scripted checks
if (new URLSearchParams(location.search).has("debug")) {
  window.__hero = {
    state,
    flips,
    // each letter's face (0 letter, 1 brand), whether it is flipping, and ms until its next flip
    letters: () =>
      flips.map((f, i) => ({ i, brand: LETTER_BRANDS[i], face: f.face, flipping: f.flipping, mirror: [f.mx, f.my], inMs: Math.round(f.nextAt - performance.now()), held: held.has(i) })),
    // the field as rendered, one pixel per cell, for a client-px rect (scripted visual checks)
    crop: (x, y, w, h, zoom) => (updateFlips(performance.now()), scene?.cropCells(x, y, w, h, zoom)),
  };
}
