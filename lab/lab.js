// cardozo.cc/lab — the hero's dot material with nothing else on screen.
//
// hero.js draws one thing: a wordmark made of dots over a field of dots. This page keeps that material (the same blue-noise
// dither, the same dots on a checkerboard lattice, the same flicker and twinkle, the calm sea of the ambient field, the way
// dots land when something appears) and takes everything else away: no wordmark, links, pointer, curtain, waves, theme switch
// or zoom. In their place there is a stage: whatever is drawn on it (an image, a video loop, an animated GIF, or a sketch in
// JS) is read as tone and printed in dots. It starts with the CD, spinning in the middle.
//
// How it works. The stage is a 2D canvas with one pixel per dither cell. Every frame the source is placed on it (scaled,
// rotated), then two passes run, exactly as in the hero: FIELD reads the stage per cell and decides which dots are lit and how
// bright (a cell's tone is the density of its dots, so a wedge of the CD is a patch of denser, brighter dots); COMPOSE blows
// the cells up to exact squares. The dither is fixed to the screen, so a moving picture shimmers through it.
//
// Put things on it: ?src=<url> (image, gif, mp4/webm), drop or paste a file on the page, or window.__lab.sketch(fn).
// Knobs are query parameters and live in window.__lab.P (see README, "Lab").
import { blueNoise } from "../raster.js";

const canvas = document.getElementById("scene");
const q = new URLSearchParams(location.search);
const num = (k, d) => {
  const v = parseFloat(q.get(k));
  return Number.isFinite(v) ? v : d;
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const DEFAULT_SRC = "media/cd.png";
const DEFAULT_SPIN = 40; // deg/s: one turn in 9 s
const P = {
  src: q.get("src") || DEFAULT_SRC,
  spin: num("spin", 0), // deg/s, positive = clockwise. Unless ?spin= is given, the CD turns (DEFAULT_SPIN) and whatever replaces it stands still
  size: num("size", 0.8), // contain: the picture's longer side, as a share of the screen's shorter one
  fit: q.get("fit") === "cover" ? "cover" : "contain",
  cell: num("cell", 1.2), // CSS px per dither cell (the hero's is ~1.2 on a desktop; never under 2 device px)
  dens: num("dens", 1.2), // share of lattice sites lit at full tone; above 1 the brightest tones saturate to a solid checkerboard (the hero's letters: 0.72)
  gamma: num("gamma", 1), // tone curve: > 1 darker mid-tones, < 1 lighter
  black: num("black", 0.3), // levels: the tone that prints nothing (the CD's body sits between 0.5 and 0.72, so it needs stretching)…
  white: num("white", 0.9), // …and the tone that prints full
  lattice: num("lattice", 1), // 1: bright areas sit on the checkerboard (dots never fuse, the hero's letters); 0: free blue noise
  field: num("field", 1), // the ambient field of dots round the picture, 0 … 1
  color: num("color", 0), // 0: paper-white dots (the hero); 1: each dot takes its source's hue
  flicker: num("flicker", 1), // depth of the picture's flicker, × the hero's
  build: num("build", 2.8), // s: the dots land in when a source appears (0 = no build)
};

// ------------------------------------------------------------------ the build
// How fast dots land (Lucas's sketch, the same as hero.js's BUILD_RATE): [from t, to t, from v, to v, shape], shape 0 linear,
// k > 0 a decay fast first then flat, -1 an abrupt jump. The fill is the integral, normalised so it ends exactly at 1.
const BUILD_RATE = [
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
function buildRate(t) {
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
function buildProgress(t) {
  const n = BUILD_TABLE.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return BUILD_TABLE[i] + (BUILD_TABLE[i + 1] - BUILD_TABLE[i]) * (x - i);
}

// ------------------------------------------------------------------ shaders
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// The hero's FIELD shader, minus everything that is not material (no wordmark, pointer, curtain, waves, theme, zoom), with the
// picture on the stage where the letters were. The numbers are the hero's.
const FIELD = `
precision highp float;
#define DOT_FADE 0.12      // a dot fades over this much density past its threshold (no popping)
#define DOT_FLOOR 0.3      // below this intensity a dot is fully off (true black stays off)
#define TONE_L 0.97        // picture dot tone
#define TONE_BRIGHT 0.75   // a dim tone's dots are this bright: tone is carried by density, the dots stay crisp (the hero's darkest layer is 0.5)
#define TWINKLE 0.3        // per-dot twinkle depth (the picture at 35% of it)
#define FLICK_C 0.8        // every dot wanders between random brightnesses: how deep in the field…
#define FLICK_L 0.4        // …and in the picture
#define FIELD_TINT vec3(0.9, 0.94, 1.0)
#define SEA_AMP 0.9        // calm-sea drift of the field, cells
#define SEA_SCALE 0.3      // swell size, screen heights
#define SEA_SPEED 0.05     // swell speed
#define SEA_RIPPLE 0.07    // ripple frequency, per cell (about 14-cell clusters)
#define BUILD_GAIN 1.03    // arrival rate (>= 1 so every site has arrived when the build ends)
#define FLASH 0.06         // a dot flashes bright on arrival, fading over this much of the build
#define BG vec3(0.0)                       // true black…
#define FG vec3(0.9412, 0.9373, 0.9176)    // …and paper #f0efea

uniform vec2  uCells;     // field size, in cells
uniform float uCell;      // device px per cell
uniform float uTime;
uniform float uIntro;     // the build, 0 … 1
uniform vec4  uA;         // density, gamma, black, white
uniform vec4  uB;         // lattice, field, colour, flicker
uniform sampler2D uBlue;
uniform sampler2D uStage; // the picture, one texel per cell

float blue(vec2 p) {
  return texture2D(uBlue, (mod(p, 64.0) + 0.5) / 64.0).r;
}
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
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

// the ambient field: 1 in the middle of the screen (where the wordmark was), falling off toward the edges, warped by slow noise
float fieldAt(vec2 p) {
  vec2 lc = 0.5 * uCells;
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
  float calm = smoothstep(0.0, 0.15, min(yv, 1.0 - yv));
  return (0.06 + 0.94 * fieldAt(p)) * (0.35 + 0.65 * calm);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 c = cell + 0.5;                         // this cell's centre, in cells
  vec2 lc = 0.5 * uCells;
  float th = blue(cell);                       // the cell's dither threshold…
  float th2 = blue(cell + vec2(29.0, 13.0));   // …and its own moment of arrival

  // calm sea: a slow, low-frequency swell of the field (the picture itself stays where it is)
  vec2 sp = c / (SEA_SCALE * uCells.y);
  vec2 sea = vec2(vnoise(vec3(sp, uTime * SEA_SPEED)), vnoise(vec3(sp + 7.7, uTime * SEA_SPEED + 3.1))) - 0.5;
  vec2 cs = c + sea * 2.0 * SEA_AMP;

  // every dot has its own slow phase (it breathes) and wanders between random brightnesses at its own pace
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float tw = 0.5 + 0.5 * sin(uTime * (0.45 + 1.1 * h) + h * 60.0);
  float fr = uTime * (0.5 + 1.7 * fract(h * 91.7 + 0.37)) + h * 97.0;
  float fk = fract(fr);
  fk = fk * fk * (3.0 - 2.0 * fk);
  float flick = mix(hash3(vec3(cell, floor(fr))), hash3(vec3(cell, floor(fr) + 1.0)), fk);

  // ---- the picture: its luminance is the tone (after the levels); where there is any, the picture's material replaces the field's
  vec3 src = texture2D(uStage, c / uCells).rgb;
  float L = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float t = pow(clamp((L - uA.z) / max(uA.w - uA.z, 0.001), 0.0, 1.0), max(uA.y, 0.01));
  float letter = smoothstep(0.02, 0.15, t);

  // ---- the build: every site has its own arrival moment (its blue-noise rank) and lands when the fill passes it, flashing
  float flash = 0.0;
  if (uIntro < 1.0) {
    float a = uIntro * BUILD_GAIN;
    float arr = smoothstep(th2 - 0.01, th2 + 0.01, a);
    flash = arr * letter * exp(-max(a - th2, 0.0) / FLASH);
    letter *= arr;
  }

  // ---- the field: the hero's ambient dots, free blue noise, dim and cool
  vec2 pc = (cs - lc) / uCells.y;
  float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
  float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;
  float rip = vnoise(vec3(cs * SEA_RIPPLE, uTime * 0.12));
  float ripple = mix(1.0, 0.35 + 1.3 * rip, 0.6);
  float D = densityAt(cs);
  float lumC = (0.018 + 0.05 * D) * (0.45 + nz) * (1.0 + 0.6 * wave) * ripple * uB.y;
  float toneC = (0.48 + 0.12 * D) * (1.0 - TWINKLE * tw) * (1.0 - FLICK_C * (1.0 - flick));

  // ---- the picture's dots: density follows the tone; bright areas sit on the checkerboard lattice (so dense dots never fuse)
  float lumL = uA.x * t;
  float site = mix(1.0, 1.0 - mod(cell.x + cell.y, 2.0), uB.x * smoothstep(0.2, 0.6, t) * letter);
  float lum = max(mix(lumC, lumL, letter), 0.0);
  // a dot's intensity rises smoothly as the density passes its threshold: changes fade, nothing pops
  float on = site * clamp((lum - th) / (DOT_FADE * lum + 0.004), 0.0, 1.0);
  on *= step(DOT_FLOOR, on);

  float toneL = TONE_L * mix(TONE_BRIGHT, 1.0, t) * (1.0 - 0.35 * TWINKLE * tw)
    * mix(0.72, 1.0, smoothstep(0.75, 1.0, uIntro))
    * (1.0 - FLICK_L * uB.w * (1.0 - sqrt(flick)));
  float tone = mix(mix(toneC, toneL, letter), 1.0, flash);
  vec3 chroma = src / max(max(src.r, max(src.g, src.b)), 0.001); // the source's hue at full strength
  vec3 tint = mix(FIELD_TINT, mix(vec3(1.0), chroma, uB.z), max(letter, flash));
  gl_FragColor = vec4(mix(BG, FG * tint, on * clamp(tone, 0.0, 1.0)), 1.0);
}
`;

// Blow each cell up to an exact square (nearest).
const COMPOSE = `
precision highp float;
uniform sampler2D uField;
uniform vec2  uCells;
uniform float uCell;
void main() {
  vec2 cs = clamp(floor(gl_FragCoord.xy / uCell), vec2(0.0), uCells - 1.0);
  gl_FragColor = vec4(texture2D(uField, (cs + 0.5) / uCells).rgb, 1.0);
}
`;

// ------------------------------------------------------------------ WebGL
const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
if (!gl) throw new Error("cardozo.cc/lab needs WebGL");

const compile = (type, src) => {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
};
const program = (frag) => {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, "position");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
};
const field = program(FIELD);
const compose = program(COMPOSE);

gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
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
// unit 0: the stage · 1: blue noise · 3: the field (render target), as in the hero
const stageTex = texture(0, gl.NEAREST, gl.CLAMP_TO_EDGE);
texture(1, gl.NEAREST, gl.REPEAT);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
const fieldTex = texture(3, gl.NEAREST, gl.CLAMP_TO_EDGE);
const fbo = gl.createFramebuffer();

const locs = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
const UF = locs(field, ["uCells", "uCell", "uTime", "uIntro", "uA", "uB", "uBlue", "uStage"]);
const UC = locs(compose, ["uField", "uCells", "uCell"]);
gl.useProgram(field);
gl.uniform1i(UF.uStage, 0);
gl.uniform1i(UF.uBlue, 1);
gl.useProgram(compose);
gl.uniform1i(UC.uField, 3);

// the stage: a 2D canvas, one pixel per cell
const stage = document.createElement("canvas");
const sctx = stage.getContext("2d", { alpha: false });

// A cell is P.cell CSS px (1.2: what the hero's has on a desktop), and never under 2 device px.
const dpr = Number(q.get("dpr")) || window.devicePixelRatio || 1;
let CELL = 2;
let cells = [1, 1];
let dev = [1, 1];
function resize() {
  CELL = Math.max(2, Math.round(dpr * P.cell));
  dev = [Math.max(1, Math.round((canvas.clientWidth || innerWidth) * dpr)), Math.max(1, Math.round((canvas.clientHeight || innerHeight) * dpr))];
  cells = [Math.ceil(dev[0] / CELL), Math.ceil(dev[1] / CELL)];
  canvas.width = dev[0];
  canvas.height = dev[1];
  stage.width = cells[0];
  stage.height = cells[1];
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, fieldTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
new ResizeObserver(resize).observe(canvas);
resize();

// ------------------------------------------------------------------ sources
// A source is { el, w, h } (an image, a video: placed, scaled and spun on the stage) or { draw(ctx, t, W, H) } (a sketch that
// draws on the stage itself, in cell units, white on black).
let source = null;
let clock = 0; // s: the lab's own time (spin, the build, the dots); stops while paused
let buildT0 = 0;
let paused = false;

const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const GIF_RE = /\.gif(\?|#|$)/i;
const SKETCHES = {
  // rings that grow out of the middle and fade
  rings(ctx, t, W, H) {
    const m = Math.min(W, H);
    ctx.lineWidth = m * 0.012;
    for (let i = 0; i < 6; i++) {
      const u = (t * 0.25 + i / 6) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${(1 - u) * 0.95})`;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, u * m * 0.45, 0, 7);
      ctx.stroke();
    }
  },
  // a radar sweep: a disc lit by a turning wedge, fading behind it
  sweep(ctx, t, W, H) {
    const g = ctx.createConicGradient(t * 1.2, W / 2, H / 2);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.45, "#000");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.4, 0, 7);
    ctx.fill();
  },
};

// (kept in the document but out of sight: an animated GIF only advances there, and some browsers only run a video that is)
function park(el) {
  Object.assign(el.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(el);
  return el;
}
const sameOrigin = (url) => new URL(url, location.href).origin === location.origin || /^(blob|data):/.test(url);

async function loadImage(url, name) {
  const img = new Image();
  if (!sameOrigin(url)) img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  if (GIF_RE.test(name)) park(img);
  return { el: img, w: img.naturalWidth, h: img.naturalHeight, name };
}
async function loadVideo(url, name) {
  const v = document.createElement("video");
  Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, preload: "auto" });
  if (!sameOrigin(url)) v.crossOrigin = "anonymous";
  park(v);
  v.src = url;
  await new Promise((ok, no) => {
    v.onloadedmetadata = ok;
    v.onerror = () => no(new Error(`could not load video ${name}`));
  });
  if (!paused) await v.play().catch(() => {});
  return { el: v, get w() { return v.videoWidth; }, get h() { return v.videoHeight; }, name };
}

function setSource(next) {
  if (source?.el instanceof HTMLElement) source.el.remove();
  if (source?.el instanceof HTMLVideoElement) source.el.pause();
  source = next;
  buildT0 = clock;
  if (!q.has("spin")) P.spin = next.name === DEFAULT_SRC ? DEFAULT_SPIN : 0;
}

// `what` is a URL, a File (dropped or pasted), or "sketch:<name>"
async function load(what) {
  try {
    if (typeof what === "string" && what.startsWith("sketch:")) {
      const fn = SKETCHES[what.slice(7)];
      if (!fn) throw new Error(`no sketch called ${what.slice(7)} (have: ${Object.keys(SKETCHES).join(", ")})`);
      return setSource({ draw: fn, name: what });
    }
    const isFile = typeof File !== "undefined" && what instanceof File;
    const url = isFile ? URL.createObjectURL(what) : what;
    const name = isFile ? what.name : what;
    const video = isFile ? what.type.startsWith("video/") : VIDEO_RE.test(name);
    setSource(video ? await loadVideo(url, name) : await loadImage(url, name));
  } catch (err) {
    console.error(err); // (the previous source stays)
  }
}
const sketch = (fn) => setSource({ draw: fn, name: "sketch" });

// ------------------------------------------------------------------ the stage, every frame
function place() {
  const W = stage.width;
  const H = stage.height;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.fillStyle = "#000";
  sctx.fillRect(0, 0, W, H);
  if (!source) return;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  if (source.draw) {
    sctx.save();
    source.draw(sctx, clock, W, H);
    sctx.restore();
    return;
  }
  const { el, w, h } = source;
  if (!w || !h) return; // (a video that has not got its first frame yet)
  const s = P.fit === "cover" ? Math.max(W / w, H / h) : (Math.min(W, H) * P.size) / Math.max(w, h);
  sctx.translate(W / 2, H / 2);
  sctx.rotate(((P.spin * Math.PI) / 180) * clock);
  sctx.scale(s, s);
  sctx.drawImage(el, -w / 2, -h / 2);
}

function draw() {
  place();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, stageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);

  // pass 1: the field, one fragment per cell
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, cells[0], cells[1]);
  gl.useProgram(field);
  gl.uniform2f(UF.uCells, cells[0], cells[1]);
  gl.uniform1f(UF.uCell, CELL);
  gl.uniform1f(UF.uTime, clock);
  gl.uniform1f(UF.uIntro, P.build > 0 ? buildProgress((clock - buildT0) / P.build) : 1);
  gl.uniform4f(UF.uA, P.dens, P.gamma, P.black, P.white);
  gl.uniform4f(UF.uB, P.lattice, P.field, P.color, P.flicker);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // pass 2: compose at device pixels
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, dev[0], dev[1]);
  gl.useProgram(compose);
  gl.uniform2f(UC.uCells, cells[0], cells[1]);
  gl.uniform1f(UC.uCell, CELL);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) clock += dt;
  draw();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ input
function pause(on = !paused) {
  paused = on;
  if (source?.el instanceof HTMLVideoElement) paused ? source.el.pause() : source.el.play().catch(() => {});
}
const rebuild = () => (buildT0 = clock);
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f);
});
addEventListener("paste", (e) => {
  const f = e.clipboardData?.files?.[0];
  if (f) load(f);
});
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") {
    e.preventDefault();
    pause();
  } else if (e.key === "b") rebuild();
});

// for tuning in the console and for checks (step(ms): advance the lab's clock and draw, in a preview that throttles frames)
window.__lab = {
  P,
  load,
  sketch,
  SKETCHES,
  pause,
  rebuild,
  resize,
  draw,
  step: (ms = 16) => ((clock += ms / 1000), draw()),
  shot: () => (draw(), canvas.toDataURL("image/png")),
  info: () => ({ cell: CELL, cells: [...cells], dev: [...dev], dpr, clock, paused, source: source?.name ?? null }),
};

load(P.src).then(() => requestAnimationFrame(frame));
