// cardozo.cc hero — the CRDZC wordmark as a dynamic, dithered, pointer-lit object (WebGL),
// plus the boot sequence. No dependencies. Everything degrades: without WebGL the inline SVG
// wordmark stays; with prefers-reduced-motion it renders one still frame and skips the boot.

const html = document.documentElement;
const hero = document.getElementById("hero");
const canvas = hero.querySelector(".scene");
const logoSvg = hero.querySelector(".logo svg");

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(hover: none)").matches;

const INK = [5 / 255, 5 / 255, 5 / 255];
const PAPER = [242 / 255, 242 / 255, 238 / 255];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : letters rise and light up, one by one
  pxMul: reduce ? 1 : 5, // dither cell multiplier : coarse → fine as the wordmark "resolves"
  hover: 0,
  mouse: [0.3, 0.12], // light position, -1..1 in canvas space (y up)
  target: [0.3, 0.12],
  lastPointer: -1e9,
  inside: false,
  time: reduce ? 4 : 0,
  logo: [0, 0, 1, 1], // x, y (bottom-left), w, h of the wordmark in canvas px
  logoCss: [0, 0, 1, 1], // left, top, w, h of the wordmark in CSS px (for hit-testing letters)
  px: 5, // base dither cell, in canvas px
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
  f.dur = rand(620, 900);
}

function updateFlips(now) {
  flips.forEach((f, i) => {
    let sx = f.mx;
    let sy = f.my;
    if (f.flipping) {
      const t = clamp01((now - f.t0) / f.dur);
      const s = Math.cos(Math.PI * easeInOutCubic(t));
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
//   R coverage · G height above the nearest edge (bevel) · B glow outside the letters.
// The shader turns G into normals, so flat vector letters get a sculpted, lit surface.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const MARGIN = 110; // transparent border (texels) so the outer glow fits and sampling past the edge reads 0
const BEVEL = 46; // texels: how far in from an edge the surface keeps rising
const GLOW = 70; // texels: reach of the outer glow

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

  const inside = distanceTransform(solid, tw, th, 0); // distance of letter texels to the nearest outside texel
  const outside = distanceTransform(solid, tw, th, 1); // distance of outside texels to the nearest letter texel

  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = rgba[i * 4];
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / 3 / BEVEL) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / 3 / GLOW) * 255);
    data[i * 4 + 3] = 255;
  }
  return { data, tw, th, cw, ch };
}

// ------------------------------------------------------------------ shader
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
uniform float uHover;
uniform float uIntro;
uniform float uPx;
uniform vec4  uLogo;      // x, y (bottom-left), w, h of the wordmark, in canvas px
uniform vec2  uTexScale;  // content size / texture size
uniform vec2  uTexOff;    // margin / texture size
uniform vec2  uTexSize;
uniform vec2  uFlip[5];   // per letter: horizontal / vertical scale (-1..1, 0 = edge-on mid-flip)
uniform vec3  uInk;
uniform vec3  uPaper;
uniform sampler2D uBayer;
uniform sampler2D uMask;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash(i),                       hash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

float fbm(vec3 p) {
  return vnoise(p) * 0.65 + vnoise(p * 2.3 + 7.1) * 0.35;
}

// which of the five letters this x belongs to (C R D Z C), from their bounding boxes
float letterIndex(float u) {
  return step(18.55 / 90.0, u) + step(36.15 / 90.0, u) + step(54.75 / 90.0, u) + step(71.15 / 90.0, u);
}

// visual centre of each letter (u along the wordmark) and the gap midpoints that bound it
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

// Organic distance from the wordmark's centre: 1 at the wordmark, fading to ~0 at the far edges.
// It is measured in screen-relative units, so it is an ellipse inscribed in whatever shape the
// screen has (wide desktop, tall phone), and noise warps it so it reads like a cloud, not a circle.
float gradAt(vec2 posPx, vec2 lc) {
  vec2 pn = (posPx - lc) / (0.5 * uRes);   // -1..1 across the screen
  vec2 pc = (posPx - lc) / uRes.y;         // for the noise lookups
  vec2 warp = vec2(
    vnoise(vec3(pc * 1.5 + vec2(3.1, 1.7), uTime * 0.05)),
    vnoise(vec3(pc * 1.5 + vec2(8.2, 4.4), uTime * 0.05 + 9.0))
  ) - 0.5;
  float gd = length(pn + warp * 0.95);
  return exp(-gd * gd * 2.25);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 lc = uLogo.xy + 0.5 * uLogo.zw; // wordmark centre, in px

  // pointer / light: a lens with a noise-wobbled edge
  vec2 mpx = (uMouse * 0.5 + 0.5) * uRes;
  float dm = length(frag - mpx) / uRes.y;
  dm *= 1.0 + 0.7 * (vnoise(vec3(frag / uRes.y * 3.0, uTime * 0.2)) - 0.5);
  float k = smoothstep(0.03, 0.26, dm / (0.45 + uHover * 0.55));

  // resolution gradient: pixels are finest at the wordmark and grow toward the edges.
  // Hovering sharpens everything a little, and a lot around the pointer.
  float g0 = gradAt(frag, lc);
  float px = uPx * mix(0.55, 1.9, 1.0 - g0) * (1.0 - 0.22 * uHover) * mix(0.4, 1.0, k);
  px = max(1.0, floor(px));

  vec2 cell = floor(frag / px);
  vec2 c = (cell + 0.5) * px;
  float g = gradAt(c, lc);

  // wordmark space: u along it, v up, and a copy in units of the wordmark's height
  vec2 q0 = (c - uLogo.xy) / uLogo.zw;
  float aspect = uLogo.z / uLogo.w;
  vec2 qa0 = vec2(q0.x * aspect, q0.y);

  // the whole wordmark breathes: slow noise bends the sampling, and bends more right under the light
  float amp = 0.02 + 0.04 * uHover * exp(-dm * 5.0);
  vec2 wob = vec2(
    vnoise(vec3(qa0 * 2.1, uTime * 0.33)),
    vnoise(vec3(qa0 * 2.1 + vec2(7.3, 2.9), uTime * 0.29))
  ) - 0.5;
  vec2 q = q0 + vec2(wob.x * amp / aspect, wob.y * amp) * 2.0;

  float li = letterIndex(q.x);

  // each letter can flip, horizontally or vertically, around its own centre
  vec2 fs = flipFor(li);
  float cu = letterCenter(li);
  vec2 qf = vec2(cu + (q.x - cu) / fs.x, 0.5 + (q.y - 0.5) / fs.y);
  vec2 bnd = letterBounds(li);
  float inBox = step(bnd.x, qf.x) * step(qf.x, bnd.y) * step(-0.02, qf.y) * step(qf.y, 1.02);

  // entrance: each letter rises out of the bottom edge, one after the other
  float e = clamp(uIntro * 1.7 - li * 0.14, 0.0, 1.0);
  e = 1.0 - pow(1.0 - e, 3.0);
  float clip = mix(step(0.0, q0.y), 1.0, e);
  vec2 rise = vec2(0.0, 1.0 - e);

  vec2 tcL = (qf + rise) * uTexScale + uTexOff; // the letter itself (flipped)
  vec2 tcG = (q + rise) * uTexScale + uTexOff;  // the halo around the wordmark (not flipped)
  vec4 t = maskAt(tcL);
  float cov = smoothstep(0.35, 0.65, t.r) * inBox * clip;
  float hgt = t.g;
  float bRaw = maskAt(tcG).b;
  float glow = pow(bRaw, 2.4) * clip * (0.5 + 0.5 * abs(fs.x * fs.y));

  // a gentle bevel, mirrored along with the letter
  vec2 d = 2.0 / uTexSize;
  float hr = smoothstep(0.0, 1.0, maskAt(tcL + vec2(d.x, 0.0)).g);
  float hl = smoothstep(0.0, 1.0, maskAt(tcL - vec2(d.x, 0.0)).g);
  float hu = smoothstep(0.0, 1.0, maskAt(tcL + vec2(0.0, d.y)).g);
  float hd = smoothstep(0.0, 1.0, maskAt(tcL - vec2(0.0, d.y)).g);
  vec3 n = normalize(vec3(-(hr - hl) * 6.0 * sign(fs.x), -(hu - hd) * 6.0 * sign(fs.y), 1.0));

  vec2 qa = vec2(q.x * aspect, q.y);
  float nz = fbm(vec3(qa * 2.6, uTime * 0.12));

  // light: a point light follows the pointer. The letters stay flat and mostly solid;
  // the light only decides how much of the dither shows through.
  vec2 lpq = (mpx - uLogo.xy) / uLogo.zw;
  vec3 lp = vec3(lpq.x * aspect, lpq.y, 0.55);
  vec3 L = lp - vec3(qa, 0.0);
  float dist = length(L);
  float att = 1.0 / (1.0 + 2.4 * dist * dist);
  float pl = max(dot(n, L / dist), 0.0) * att;
  float keyL = max(dot(n, normalize(vec3(-0.45, 0.65, 0.62))), 0.0);
  float rim = pow(1.0 - hgt, 2.0);
  float lit = clamp(att * 1.5 + pl * 0.8, 0.0, 1.0);
  float lumL = (mix(0.97, 1.06, lit) + 0.03 * keyL - 0.06 * rim) * (0.98 + 0.04 * nz);

  // outside the letters: a cloud of pixels, dense around the wordmark and thinning toward the
  // edges (organically, through noise), a thin clean moat so the letters stay crisp, and a bloom
  // under the pointer that burns brighter while you hover
  vec2 pcc = (c - lc) / uRes.y;
  float edgeFade = smoothstep(0.0, 0.14, min(frag.y, uRes.y - frag.y) / uRes.y); // calm zone behind the labels
  float cloud = pow(g, 1.25) * 0.36 * (0.7 + 0.6 * vnoise(vec3(pcc * 5.0, uTime * 0.08))) * (0.35 + 0.65 * edgeFade);
  float scatter = 0.012 + 0.012 * vnoise(vec3(pcc * 2.0 + 4.0, uTime * 0.06));
  float moat = 1.0 - 0.9 * smoothstep(0.8, 0.97, bRaw);
  float near = exp(-dm * dm * 26.0);
  float lumB = (cloud + glow * (0.10 + 0.45 * att)) * moat
             + scatter * (0.3 + 0.7 * edgeFade)
             + (0.08 + 0.26 * uHover) * near * (0.55 + 0.45 * edgeFade);
  float star = step(0.9975, hash2(cell));
  float tw = 0.5 + 0.5 * sin(uTime * 2.0 + cell.x * 0.7);
  lumB += star * 0.5 * tw;

  float lum = mix(lumB, lumL, cov);

  float threshold = texture2D(uBayer, (mod(cell, 8.0) + 0.5) / 8.0).r;
  float on = step(threshold, clamp(lum, 0.0, 1.0));
  gl_FragColor = vec4(mix(uInk, uPaper, on), 1.0);
}
`;

function bayerBytes(size) {
  let m = [[0]];
  for (let s = 1; s < size; s *= 2) {
    const k = m.length;
    const next = Array.from({ length: k * 2 }, () => new Array(k * 2));
    for (let y = 0; y < k; y++) {
      for (let x = 0; x < k; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + k] = v + 2;
        next[y + k][x] = v + 3;
        next[y + k][x + k] = v + 1;
      }
    }
    m = next;
  }
  const n = size * size;
  return new Uint8Array(m.flat().map((v) => Math.round(((v + 0.5) / n) * 255)));
}

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

  const setTex = (unit, w, h, format, pixels, filter, flip) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, format === gl.LUMINANCE ? 1 : 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, gl.UNSIGNED_BYTE, pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return t;
  };

  // unit 0: 8×8 Bayer threshold map (repeats) · unit 1: the wordmark (clamped)
  setTex(0, 8, 8, gl.LUMINANCE, bayerBytes(8), gl.NEAREST, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const wm = buildWordmarkTexture();
  setTex(1, wm.tw, wm.th, gl.RGBA, wm.data, gl.LINEAR, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = (name) => gl.getUniformLocation(prog, name);
  const U = {
    res: u("uRes"), time: u("uTime"), mouse: u("uMouse"), hover: u("uHover"),
    intro: u("uIntro"), px: u("uPx"), logo: u("uLogo"), flip: u("uFlip[0]"),
  };
  gl.uniform3fv(u("uInk"), INK);
  gl.uniform3fv(u("uPaper"), PAPER);
  gl.uniform1i(u("uBayer"), 0);
  gl.uniform1i(u("uMask"), 1);
  gl.uniform2f(u("uTexScale"), wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(u("uTexOff"), MARGIN / wm.tw, MARGIN / wm.th);
  gl.uniform2f(u("uTexSize"), wm.tw, wm.th);

  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);

    // park the WebGL wordmark exactly where the SVG sits (full-bleed, centred)
    const hr = canvas.getBoundingClientRect();
    const r = logoSvg.getBoundingClientRect();
    state.logo = [(r.left - hr.left) * dpr, (hr.bottom - r.bottom) * dpr, r.width * dpr, r.height * dpr];
    state.px = clamp(r.height / 55, 1.5, 4.5) * dpr; // fine pixels: ~55 across the wordmark's height
  };
  new ResizeObserver(() => {
    resize();
    if (reduce) draw();
  }).observe(canvas);
  resize();

  function draw() {
    gl.uniform1f(U.time, state.time);
    gl.uniform2f(U.mouse, state.mouse[0], state.mouse[1]);
    gl.uniform1f(U.hover, state.hover);
    gl.uniform1f(U.intro, state.intro);
    gl.uniform1f(U.px, state.px * state.pxMul);
    gl.uniform4f(U.logo, state.logo[0], state.logo[1], state.logo[2], state.logo[3]);
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
    state.target[0] = ((e.clientX - r.left) / r.width) * 2 - 1;
    state.target[1] = -(((e.clientY - r.top) / r.height) * 2 - 1);
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

let visible = true;
new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(hero);

let last = 0;
const t0 = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden) return;
  const dt = now - last;
  if (dt < (coarse ? 32 : 15)) return; // ~30fps on touch devices, ~60fps elsewhere
  last = now;

  state.time = (now - t0) / 1000;

  // easing that feels the same at 60 and 120 Hz
  const ease = (rate) => 1 - Math.pow(1 - rate, Math.min(dt, 100) / 16.67);

  // when nobody is steering, the light sweeps slowly back and forth across the wordmark
  const idle = now - state.lastPointer > 2600;
  const tx = idle ? 0.78 * Math.sin(state.time * 0.3) : state.target[0];
  const ty = idle ? 0.06 * Math.cos(state.time * 0.23) : state.target[1];
  state.mouse[0] += ease(0.07) * (tx - state.mouse[0]);
  state.mouse[1] += ease(0.07) * (ty - state.mouse[1]);
  state.hover += ease(0.04) * ((state.inside && !idle ? 1 : 0) - state.hover);

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
    await tween(1300, (t) => {
      state.intro = t;
      state.pxMul = lerp(3, 1, easeOutCubic(t));
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

  // the counter runs; just before it lands, the wordmark starts to rise and resolve
  const counter = tween(2000, (t) => {
    const e = easeInOutCubic(t);
    count.textContent = String(Math.round(e * 100)).padStart(3, "0");
    bar.style.transform = `scaleX(${e})`;
  });
  const entrance = wait(1500).then(() =>
    tween(1800, (t) => {
      state.intro = t;
      state.pxMul = lerp(4.5, 1, easeOutCubic(t));
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
