// cardozo.cc/swarm — one set of dots that is told to become the home's wordmark, a panel, a picture, a cube, a sphere, a column.
// An experiment (docs/PLANKTON.md §14), not the home's interface; the home is the reference (law 9), and the ref button shows it.
//
// The look is the home's: every dot is one square CELL on the screen's grid, on the checkerboard lattice, dithered by the same
// blue-noise threshold, true black. The flat layers are made cell by cell with the home's own rule (layers.js ditherBody), so a
// dot is where the home would put one; the 3D layers are even, thin and regular.
//
// The movement is a walk, not a spring. When you switch layer every dot, at its own moment (a wave from the centre through the
// picture it leaves, plus noise), goes out where it stands, then walks to its place in the next layer along the shortest path (a
// straight line), a hop at a time, and lights up with a flash when it arrives. A few dots (the carriers) stay lit on the way and
// leave a trail of the places they hopped from; the rest walk in the dark, so the eye can follow individual pixels instead of a fog.
// Dot i of one layer is near dot i of the next (a sort by place), so the walks are short.
// The dots live on the GPU: a position texture, a "from + progress" texture and a "to + hops" texture, updated every frame.
// The field (the last dots) is the home's noise over the whole page: it never walks, the camera does not turn it.
//
// The mouse: drag turns the 3D layers (the flat ones tilt and spring back), a click drops the wave.
import { N, W, H, BODY, LAYERS, FLAT, CAMERA_D, rng, dust, scatter, assemble, gridContext, ditherBody, cubeBody, sphereBody, columnBody, rotation } from "./layers.js";
import { cellPx, gapPx, gridAmount, dustKeep } from "./density.js";
import { blueNoise } from "../raster.js";

const html = document.documentElement;
const canvas = document.getElementById("scene");
const ui = document.getElementById("ui");
const slider = document.getElementById("pixel");
const nameEl = document.getElementById("layer-name");
const noEl = document.getElementById("layer-no");
const hudEl = document.getElementById("hint");
const refEl = document.getElementById("ref");
const refBtn = document.getElementById("ref-btn");
const params = new URLSearchParams(location.search);
// (?still shows the reduced-motion version on demand: the dots jump to their places, nothing moves)
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || params.has("still");

// ------------------------------------------------------------------------------------------------ the flat layers, drawn then dithered
const bn = blueNoise(); // the home's threshold map (a few tens of ms, once)
let wordmark = null; // the home's own SVG paths, read from ../index.html (one source for the wordmark)
let picture = null; // a dropped image, or null for the drawn one

async function loadWordmark() {
  try {
    const doc = new DOMParser().parseFromString(await (await fetch(new URL("../index.html", import.meta.url))).text(), "text/html");
    const ds = [...doc.querySelectorAll(".logo svg path[data-l]")].map((p) => p.getAttribute("d"));
    if (ds.length) wordmark = ds;
  } catch (err) {
    console.warn("the home's wordmark could not be read; drawing letters instead", err);
  }
}

const canvas2d = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#000";
  x.fillRect(0, 0, w, h);
  return [c, x];
};
/** cell (cx, cy), cy from the bottom → the bitmap's tone there (the bitmap is in device px, rows from the top) */
const sampler = (img, ctx) => (cx, cy) => {
  const px = Math.min(img.width - 1, Math.floor(cx * ctx.cell + ctx.cell / 2));
  const py = Math.min(img.height - 1, Math.floor(img.height - (cy * ctx.cell + ctx.cell / 2)));
  return img.data[(py * img.width + px) * 4] / 255;
};

function drawHome(ctx, dpr) {
  const [, x] = canvas2d(ctx.viewW, ctx.viewH);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cssW = ctx.viewW / dpr, cssH = ctx.viewH / dpr, w = Math.min(cssW * 0.74, 900), s = w / 90, h = 15.75 * s;
  x.fillStyle = "#fff";
  if (wordmark) {
    x.translate((cssW - w) / 2, (cssH - h) / 2);
    x.scale(s, s);
    for (const d of wordmark) x.fill(new Path2D(d));
  } else {
    x.font = `700 ${h * 1.2}px ui-sans-serif, Helvetica, Arial, sans-serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("CRDZC", cssW / 2, cssH / 2);
  }
  return x.getImageData(0, 0, ctx.viewW, ctx.viewH);
}

function drawUI(ctx, dpr) {
  const [, x] = canvas2d(ctx.viewW, ctx.viewH);
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const line = ctx.cell / dpr; // a line is exactly one cell thick
  const regions = [];
  const card = ui.querySelector(".card").getBoundingClientRect();
  x.lineWidth = line;
  x.fillStyle = "rgba(255,255,255,0.14)"; // the panel's fill: a dither
  x.strokeStyle = "#fff";
  x.beginPath();
  x.roundRect(card.left + line / 2, card.top + line / 2, card.width - line, card.height - line, 14);
  x.fill();
  x.stroke();
  x.textBaseline = "middle";
  for (const el of ui.querySelectorAll("[data-id]")) {
    const cs = getComputedStyle(el), er = el.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    x.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in x) x.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
    if (el.tagName === "BUTTON") {
      x.beginPath();
      x.roundRect(er.left + line / 2, er.top + line / 2, er.width - line, er.height - line, er.height / 2);
      x.fillStyle = "rgba(255,255,255,0.14)";
      x.fill();
      x.stroke();
    }
    x.fillStyle = "#fff";
    x.fillText(el.textContent, tr.left, tr.top + tr.height / 2);
    regions.push({ id: Number(el.dataset.id), x0: er.left * dpr, y0: er.top * dpr, x1: er.right * dpr, y1: er.bottom * dpr });
  }
  const img = x.getImageData(0, 0, ctx.viewW, ctx.viewH);
  const idAt = (cx, cy) => {
    const px = cx * ctx.cell + ctx.cell / 2, py = ctx.viewH - (cy * ctx.cell + ctx.cell / 2);
    for (const g of regions) if (px >= g.x0 && px < g.x1 && py >= g.y0 && py < g.y1) return g.id;
    return 0;
  };
  return { img, idAt };
}

/** The picture drawn when nothing was dropped: a bright core in a dark net, a flare, stars (after the references, not a copy). */
function drawCosmos(S = 640) {
  const [c, x] = canvas2d(S, S);
  const r = rng(9), cx = S / 2, cy = S * 0.52, TAU = Math.PI * 2;
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, S * 0.46);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = "#000";
  x.lineCap = "round";
  for (const [rx, ry, rot, lw] of [[230, 175, -0.35, 24], [200, 230, 0.5, 18], [250, 150, 1.2, 14]]) {
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.lineWidth = lw;
    x.beginPath();
    x.ellipse(0, 0, rx, ry, 0, 0, TAU);
    x.stroke();
    x.restore();
  }
  x.lineWidth = 8;
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * 110, cy + Math.sin(a) * 110);
    x.lineTo(cx + Math.cos(a) * 270, cy + Math.sin(a) * 270);
    x.stroke();
  }
  const bar = (bx, by, bw, bh, horizontal) => {
    const gr = horizontal ? x.createLinearGradient(bx, 0, bx + bw, 0) : x.createLinearGradient(0, by, 0, by + bh);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.9)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(bx, by, bw, bh);
  };
  bar(30, cy - 1.5, S - 60, 3, true);
  bar(cx - 1.5, 30, 3, S - 60, false);
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * r()})`;
    x.beginPath();
    x.arc(r() * S, r() * S, 0.6 + Math.pow(r(), 3) * 2.2, 0, TAU);
    x.fill();
  }
  return c;
}
/** A dropped image becomes the picture: grey, its levels stretched. It stays on this machine. */
async function pictureFromFile(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1000 / img.width, 1000 / img.height, 1);
  const [c, x] = canvas2d(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  x.drawImage(img, 0, 0, c.width, c.height);
  const bm = x.getImageData(0, 0, c.width, c.height), d = bm.data;
  let lo = 255, hi = 0;
  const lum = (i) => 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  for (let i = 0; i < c.width * c.height; i++) { const l = lum(i); if (l < lo) lo = l; if (l > hi) hi = l; }
  for (let i = 0; i < c.width * c.height; i++) {
    const v = Math.max(0, Math.min(255, ((lum(i) - lo) / Math.max(1, hi - lo)) * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  x.putImageData(bm, 0, 0);
  return c;
}
function drawPicture(ctx, dpr) {
  const src = picture || (picture = drawCosmos());
  const [, x] = canvas2d(ctx.viewW, ctx.viewH);
  const cssH = ctx.viewH / dpr, cssW = ctx.viewW / dpr, k = Math.min((cssH * 0.85) / src.height, (cssW * 0.9) / src.width) * dpr;
  const w = src.width * k, h = src.height * k;
  x.drawImage(src, (ctx.viewW - w) / 2, (ctx.viewH - h) / 2, w, h);
  return x.getImageData(0, 0, ctx.viewW, ctx.viewH);
}

// ------------------------------------------------------------------------------------------------ the layers, built for the screen's grid
let G = { dpr: 1, ctx: gridContext({ viewW: 800, viewH: 600, cell: 3, bn }), pixel: 0 }; // (set by resize)
const cache = new Map();
function build(name) {
  const { ctx, dpr } = G;
  switch (name) {
    case "home": return ditherBody(sampler(drawHome(ctx, dpr), ctx), ctx, { solid: 2 }, 11); // the home's own: lattice, DENS_L 0.72
    case "ui": {
      const { img, idAt } = drawUI(ctx, dpr);
      return ditherBody(sampler(img, ctx), ctx, { solid: 0.55, idAt }, 12); // crisp text and lines, a dithered fill
    }
    case "picture": return ditherBody(sampler(drawPicture(ctx, dpr), ctx), ctx, { dens: 1, lattice: false, solid: 2, depth: 0.2 }, 13); // tone is density
    case "cube": return cubeBody(ctx);
    case "sphere": return sphereBody(ctx);
    case "column": return columnBody(ctx);
    default: throw new Error(`no layer ${name}`);
  }
}
let dustCache = null;
const layerData = (name) => {
  const { ctx } = G;
  if (!cache.has(name)) {
    if (!dustCache || dustCache.aspect !== ctx.aspect) dustCache = { aspect: ctx.aspect, a: dust(ctx.aspect) };
    cache.set(name, assemble(build(name), dustCache.a));
  }
  return cache.get(name);
};

// ------------------------------------------------------------------------------------------------ the GPU
const FULLSCREEN = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The walk, in one place for both shaders (the update moves the dots, the draw reads their trails): how long a dot takes to walk
// the cells between its two places (the farther, the longer, but never long) and how many hops that is. A hop is a jump of a few
// cells that the dot makes at its own beat; between two hops it stands.
const WALK = `
uniform float uHop; // hops a second
float walkTime(float cells, float h2) { return clamp(cells / 110.0, 0.45, 1.6) * (0.85 + 0.3 * h2); }
float walkHops(float T) { return max(1.0, floor(T * uHop)); }`;

// each dot: waits for its moment (a wave from the centre, through the old picture), goes out where it stands, walks a straight
// line to its place a hop at a time, and lights up with a flash when it arrives.
// from.w is its progress: < 0 held where it is, 0 following the old layer, (0, uPause) going out in place, (uPause, 1) walking,
// 1 → 2 the flash after arriving, 2 settled. The third target keeps where it is going and how far along the line it has hopped.
const UPDATE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tPos, tFrom, tPrev, tNext;
uniform ivec2 uTex;
uniform float uDt, uSince, uBody, uStill, uReset, uCellWorld, uPause;
uniform vec2 uClick;
uniform mat3 uRotPrev, uRotNext;
${WALK}
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oFrom;
layout(location = 2) out vec4 oTo;
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  float fi = float(tc.x + tc.y * uTex.x);
  vec4 pos = texelFetch(tPos, tc, 0);
  vec4 fr = texelFetch(tFrom, tc, 0);
  vec4 pv = texelFetch(tPrev, tc, 0);
  vec4 nx = texelFetch(tNext, tc, 0);
  bool body = fi < uBody;
  vec3 wp = body ? uRotPrev * pv.xyz : pv.xyz;
  vec3 wn = body ? uRotNext * nx.xyz : nx.xyz;
  float h1 = h11(fi), h2 = h11(fi + 17.3), h3 = h11(fi + 41.7);
  if (uStill > 0.5) { oPos = vec4(wn, nx.w); oFrom = vec4(wn, 2.0); oTo = vec4(wn, 1.0); return; }
  float p = fr.w;
  vec3 from = fr.xyz;
  vec4 outPos = pos;
  float pq = 0.0; // how far along the line it has hopped, 0…1
  if (uReset > 0.5) p = (p >= 1.0) ? 0.0 : -1.0;   // a new switch: the arrived follow the old layer, the walkers stay where they are
  if (p <= 0.0) {
    bool follow = p > -0.5;
    vec3 hold = follow ? wp : pos.xyz;
    float wcur = follow ? pv.w : pos.w;
    float delay = distance(hold.xy, uClick) * 0.34 + h1 * 0.5;   // a wave from the switch through the picture it leaves, and a moment of each dot's own
    if (uSince > delay) {
      from = hold;
      outPos = vec4(hold, nx.w);
      p = (distance(wn, hold) < 0.5 * uCellWorld) ? 2.0 : 0.0001; // already home (the field, a dot that does not move): no walk
    } else outPos = vec4(hold, wcur);
  } else if (p < 1.0) {
    float cells = length(wn - from) / uCellWorld;
    float T = walkTime(cells, h2);
    p += uDt / T;
    float K = walkHops(T);
    float pw = clamp((min(p, 1.0) - uPause) / (1.0 - uPause), 0.0, 1.0);    // it goes out where it stands first (uPause), then walks
    pq = min(1.0, floor(pw * K + h3) / K);                                    // (each dot hops on its own beat)
    outPos = vec4(mix(from, wn, pq), nx.w);                                  // the shortest path: a straight line
    if (p >= 1.0) p = 1.0;
  } else {
    p = min(2.0, p + uDt / 0.5);
    pq = 1.0;
    outPos = vec4(wn, nx.w);                                                  // arrived: it follows the layer (a turning cube turns)
  }
  oPos = outPos;
  oFrom = vec4(from, p);
  oTo = vec4(wn, pq);
}`;

const DRAW_V = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tPos, tFrom, tTo;
uniform ivec2 uTex;
uniform float uYaw, uPitch, uD, uAspect, uTime, uHover, uPtrE, uCell, uGap, uBody, uDustKeep, uFog, uWaveT;
uniform float uCellWorld, uPause, uWalkers, uDim;
uniform vec2 uView, uPtr, uWave;
${WALK}
out vec3 vCol;
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float pulse(vec2 d, float t) { // a ring that runs out, thins and fades
  return t < 0.0 ? 0.0 : exp(-pow((length(d) - t * 1.5) / 0.1, 2.0)) * exp(-t * 1.3);
}
void main() {
  int n = uTex.x * uTex.y;
  int g = gl_VertexID / n;          // 0: the dot itself; 1, 2, 3: the places it hopped from (its trail), drawn while it walks
  int id = gl_VertexID - g * n;
  ivec2 tc = ivec2(id % uTex.x, id / uTex.x);
  vec4 s = texelFetch(tPos, tc, 0);
  vec4 fr = texelFetch(tFrom, tc, 0);
  float p = fr.w;
  float fid = floor(s.w);
  float tone = s.w - fid;
  float fi = float(id);
  float h1 = h11(fi), h2 = h11(fi + 17.3), h3 = h11(fi + 41.7), h4 = h11(fi + 93.1);
  bool field = fi >= uBody;
  bool carrier = h4 < uWalkers; // the few that stay lit on the way, so you can follow them; the rest walk in the dark
  float walking = step(0.0001, p) * (1.0 - step(1.0, p));
  float going = walking * (1.0 - step(uPause, p)); // going out where it stands
  float onway = walking - going;
  vec3 sp = s.xyz;
  bool gone = tone < 0.01 || (field && h1 > uDustKeep);
  if (g > 0) {
    // a carrier's trail: where it was one hop ago, two hops ago, three (fading); nothing for the others, nor when it stands
    vec4 to = texelFetch(tTo, tc, 0);
    float cells = length(to.xyz - fr.xyz) / uCellWorld;
    float K = walkHops(walkTime(cells, h2));
    gone = gone || !carrier || onway < 0.5 || cells / K < 0.5;
    sp = mix(fr.xyz, to.xyz, max(0.0, to.w - float(g) / K));
  }
  if (gone) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  float cy = cos(uYaw), sy = sin(uYaw), cx = cos(uPitch), sx = sin(uPitch);
  vec3 q = vec3(cy * sp.x + sy * sp.z, sp.y, -sy * sp.x + cy * sp.z);
  q = vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
  if (field) q = sp; // the field is the page's own noise: the camera does not turn it
  vec2 ndc = vec2(q.x / uAspect, q.y) * uD / (uD - q.z);
  vec2 a = vec2(uAspect, 1.0);
  // the pointer: a hole in the dots with a push round it; moving it stirs more
  vec2 dd = (ndc - uPtr) * a;
  float r = length(dd);
  ndc += (dd / (r + 1e-4)) * exp(-pow(r / 0.14, 2.0)) * (0.03 + 0.07 * uPtrE) / a;
  float hole = step(0.28, 1.0 - exp(-pow(r / 0.035, 2.0)));
  // the wave: two pulses from the click, pushing and lighting what they cross
  vec2 wd = (ndc - uWave) * a;
  float ring = pulse(wd, uWaveT) + 0.6 * pulse(wd, uWaveT - 0.2);
  ndc += (wd / (length(wd) + 1e-4)) * ring * 0.035 / a;
  // brightness: the home's flicker; going out it stutters (lit less and less often); on the way a carrier is lit, bright and
  // even, and the others are dark (uDim); a flash on arriving; a hovered element steady
  float flick = 0.5 + 0.5 * sin(uTime * (0.6 + 1.8 * h2) + h3 * 6.283);
  float b = tone * (1.0 - 0.4 * (1.0 - sqrt(flick)));
  float u = clamp(p / max(uPause, 0.001), 0.0, 1.0);
  float lit = step(fract(u * 9.0 + h3), 1.0 - u);
  b = mix(b, b * lit, going);
  b = mix(b, mix(uDim * b, 0.95, float(carrier)), onway);
  if (g > 0) b = 0.95 * pow(0.55, float(g));
  float flash = step(1.0, p) * (1.0 - step(2.0, p)) * (1.0 - (p - 1.0));
  b = min(1.0, b + 0.9 * flash * flash);
  if (fid > 0.5 && abs(fid - uHover) < 0.5) b = max(b, 0.95);
  b = min(1.0, b + 0.55 * min(ring, 1.0));
  b *= hole * mix(1.0, clamp(0.72 + 0.55 * q.z, 0.4, 1.0), uFog * (field ? 0.0 : 1.0));
  vCol = (field ? vec3(0.9, 0.94, 1.0) * 0.44 : vec3(0.94, 0.935, 0.9)) * b; // (the home's field: cool dim greys, measured: mean level ÷ lit share ≈ 0.24)
  // the screen's grid: a dot is the whole cell it falls in, and off the lattice it steps onto it (the home's checkerboard)
  vec2 px = (ndc * 0.5 + 0.5) * uView;
  vec2 c = floor(px / uCell);
  if (!field && tone < 0.995 && mod(c.x + c.y, 2.0) > 0.5) c.x += (h2 < 0.5 ? -1.0 : 1.0);
  ndc = ((c + 0.5) * uCell / uView) * 2.0 - 1.0;
  gl_PointSize = uCell - uGap;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

const DRAW_F = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 1.0); }`;

// the screen's own grid, faintly, behind the dots: one tile per cell, each with a slow life of its own
const GRID_F = `#version 300 es
precision highp float;
uniform float uCell, uGap, uGrid, uTime;
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 f = gl_FragCoord.xy - cell * uCell;
  float g = uGap * 0.5;
  float inside = step(g, f.x) * step(g, f.y) * step(f.x, uCell - g) * step(f.y, uCell - g);
  float life = 0.7 + 0.3 * sin(uTime * (0.4 + h21(cell) * 1.2) + h21(cell + 7.0) * 6.283);
  o = vec4(0.94, 0.935, 0.9, 0.06 * uGrid * inside * life);
}`;

function program(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function start() {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("no WebGL2");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no float render targets");
  const upd = program(gl, FULLSCREEN, UPDATE);
  const drw = program(gl, DRAW_V, DRAW_F);
  const grd = program(gl, FULLSCREEN, GRID_F);
  const f32 = (data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const upload = (t, data) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, data);
  };

  // ---- the walk's knobs (the URL sets them; __swarm.walk changes them live)
  const knob = (name, d, lo, hi) => Math.min(hi, Math.max(lo, params.has(name) && params.get(name) !== "" && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : d));
  const walk = {
    hop: knob("hop", 18, 4, 60), // hops a second
    walkers: knob("walkers", 0.16, 0, 1), // the share of the dots that stay lit on the way: the ones you can follow
    pause: knob("pause", 0.14, 0.02, 0.6), // the share of the walk spent going out where it stands
    dim: knob("dim", 0, 0, 1), // how lit the others are on the way (0: dark)
    trail: Math.round(knob("trail", 3, 0, 3)), // the hops a carrier remembers, drawn fading behind it
  };
  const WALK_SPAN = 4; // seconds: the longest wait (1.1) + the longest walk (1.9) + the flash (0.5), with room

  // ---- the world's state
  let read = 0, cur = 1; // state[read] is the latest; targets[cur] is the next layer, targets[1 − cur] the previous
  let prevName = "scatter", nextName = LAYERS[0], layerIdx = 0;
  let time = 0, since = 0, reset = 1, waveT = 9, wave = [9, 9], click = [0, 0];
  let hover = 0, pixel = Math.min(1, Math.max(0, Number(params.get("pixel")) || 0));
  let refOn = false, paused = false;
  const ptr = { x: 9, y: 9, sx: 9, sy: 9, e: 0, has: false };
  const cam = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
  const drag = { on: false, x: 0, y: 0, sx: 0, sy: 0, t0: 0, moved: false };

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const viewW = Math.max(1, Math.round(innerWidth * dpr)), viewH = Math.max(1, Math.round(innerHeight * dpr));
    canvas.width = viewW;
    canvas.height = viewH;
    G = { dpr, pixel, ctx: gridContext({ viewW, viewH, cell: cellPx(pixel, dpr), bn }) };
    cache.clear();
  }
  resize();

  const scatterArr = () => assemble(scatter(), dust(G.ctx.aspect));
  const start0 = scatterArr();
  const state = [0, 1].map(() => {
    const pos = f32(start0), from = f32(new Float32Array(N * 4)), to = f32(new Float32Array(N * 4));
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, from, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, to, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("incomplete framebuffer");
    return { pos, from, to, fbo };
  });
  const targets = [f32(start0), f32(new Float32Array(N * 4))];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function simulate(dt) {
    const e = Math.min(dt, 1 / 30);
    time += reduce ? 0 : e;
    since += e;
    waveT += e;
    if (ptr.has) {
      const lx = ptr.sx, ly = ptr.sy, k = 1 - Math.exp(-e * 16);
      ptr.sx = ptr.sx > 8 ? ptr.x : ptr.sx + (ptr.x - ptr.sx) * k;
      ptr.sy = ptr.sy > 8 ? ptr.y : ptr.sy + (ptr.y - ptr.sy) * k;
      ptr.e = Math.min(1, ptr.e + Math.min(Math.hypot(ptr.sx - lx, ptr.sy - ly) / Math.max(e, 1e-3), 6) * e * 0.5);
    }
    ptr.e *= Math.exp(-e / 1.4);
    // the drag turns the 3D layers (and keeps turning a little); the flat ones tilt and spring back when you let go
    if (!drag.on) {
      if (FLAT.has(nextName)) {
        const k = 1 - Math.exp(-e * 6);
        cam.yaw -= cam.yaw * k;
        cam.pitch -= cam.pitch * k;
        cam.vyaw = cam.vpitch = 0;
      } else {
        cam.yaw += cam.vyaw * e;
        cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + cam.vpitch * e));
        const d = Math.exp(-e * 2.2);
        cam.vyaw *= d;
        cam.vpitch *= d;
      }
    }

    const src = state[read], dst = state[1 - read];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(upd.p);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(upd.u[name], unit);
    };
    bind(0, src.pos, "tPos");
    bind(1, src.from, "tFrom");
    bind(2, targets[1 - cur], "tPrev");
    bind(3, targets[cur], "tNext");
    gl.uniform2i(upd.u.uTex, W, H);
    gl.uniform1f(upd.u.uDt, e);
    gl.uniform1f(upd.u.uSince, since);
    gl.uniform1f(upd.u.uBody, BODY);
    gl.uniform1f(upd.u.uStill, reduce ? 1 : 0);
    gl.uniform1f(upd.u.uReset, reset);
    gl.uniform1f(upd.u.uCellWorld, G.ctx.cellWorld);
    gl.uniform1f(upd.u.uHop, walk.hop);
    gl.uniform1f(upd.u.uPause, walk.pause);
    gl.uniform2f(upd.u.uClick, click[0], click[1]);
    gl.uniformMatrix3fv(upd.u.uRotPrev, false, rotation(prevName, time));
    gl.uniformMatrix3fv(upd.u.uRotNext, false, rotation(nextName, time));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    reset = 0;
    read = 1 - read;
  }

  function draw() {
    const { ctx } = G, cell = ctx.cell, gap = gapPx(cell), grid = gridAmount(pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.viewW, ctx.viewH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (grid > 0 && params.get("gridlines") !== "0") {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(grd.p);
      gl.uniform1f(grd.u.uCell, cell);
      gl.uniform1f(grd.u.uGap, gap);
      gl.uniform1f(grd.u.uGrid, grid);
      gl.uniform1f(grd.u.uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.blendEquation(gl.MAX); // a cell is lit or it is not: two dots in one cell do not add up
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(drw.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state[read].pos);
    gl.uniform1i(drw.u.tPos, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state[read].from);
    gl.uniform1i(drw.u.tFrom, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, state[read].to);
    gl.uniform1i(drw.u.tTo, 2);
    gl.uniform1f(drw.u.uCellWorld, ctx.cellWorld);
    gl.uniform1f(drw.u.uHop, walk.hop);
    gl.uniform1f(drw.u.uPause, walk.pause);
    gl.uniform1f(drw.u.uWalkers, walk.walkers);
    gl.uniform1f(drw.u.uDim, walk.dim);
    gl.uniform2i(drw.u.uTex, W, H);
    gl.uniform1f(drw.u.uYaw, FLAT.has(nextName) ? Math.max(-0.45, Math.min(0.45, cam.yaw)) : cam.yaw);
    gl.uniform1f(drw.u.uPitch, FLAT.has(nextName) ? Math.max(-0.45, Math.min(0.45, cam.pitch)) : cam.pitch);
    gl.uniform1f(drw.u.uD, CAMERA_D);
    gl.uniform1f(drw.u.uAspect, ctx.aspect);
    gl.uniform1f(drw.u.uTime, time);
    gl.uniform1f(drw.u.uHover, nextName === "ui" ? hover : 0);
    gl.uniform1f(drw.u.uPtrE, ptr.e);
    gl.uniform1f(drw.u.uCell, cell);
    gl.uniform1f(drw.u.uGap, gap);
    gl.uniform1f(drw.u.uBody, BODY);
    gl.uniform1f(drw.u.uDustKeep, dustKeep(ctx.cols, ctx.rows, N - BODY));
    gl.uniform1f(drw.u.uFog, FLAT.has(nextName) ? 0 : 1);
    gl.uniform1f(drw.u.uWaveT, waveT);
    gl.uniform2f(drw.u.uView, ctx.viewW, ctx.viewH);
    gl.uniform2f(drw.u.uPtr, ptr.has ? ptr.sx : 9, ptr.has ? ptr.sy : 9);
    gl.uniform2f(drw.u.uWave, wave[0], wave[1]);
    // the trails are only there while something walks (the switch is younger than the longest walk and its flash)
    gl.drawArrays(gl.POINTS, 0, N * (1 + (since < WALK_SPAN && !reduce ? walk.trail : 0)));
    gl.disable(gl.BLEND);
  }

  // ---- the controls: a switch for the layers, the mouse for the 3D and the wave
  function hud() {
    nameEl.textContent = nextName;
    noEl.textContent = `${layerIdx + 1}/${LAYERS.length}`;
    ui.inert = refOn || nextName !== "ui"; // the panel is only there while its layer is
  }
  /** Tell the dots to become layer i. They go out and walk there, from the centre outwards. */
  function goto(i) {
    layerIdx = ((i % LAYERS.length) + LAYERS.length) % LAYERS.length;
    prevName = nextName;
    nextName = LAYERS[layerIdx];
    cur = 1 - cur; // the texture that held the previous layer now holds the new one; the old "next" is the new "previous"
    upload(targets[cur], layerData(nextName));
    since = 0;
    reset = 1;
    click = [0, 0];
    hover = 0;
    hud();
  }
  function dropWave(ndc) {
    wave = ndc;
    waveT = 0;
  }
  const ndcOf = (e) => [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2];

  addEventListener("pointerdown", (e) => {
    if (e.target.closest?.(".hud")) return;
    Object.assign(drag, { on: true, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false });
  });
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch") {
      const [x, y] = ndcOf(e);
      ptr.x = x;
      ptr.y = y;
      ptr.has = true;
    }
    if (!drag.on) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    if (drag.moved) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      cam.yaw += dx * 0.007;
      cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + dy * 0.007));
      cam.vyaw = Math.max(-5, Math.min(5, dx * 0.007 * 50)); // (what it keeps turning at when you let go, in rad/s)
      cam.vpitch = Math.max(-5, Math.min(5, dy * 0.007 * 50));
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  addEventListener("pointerup", (e) => {
    if (!drag.on) return;
    drag.on = false;
    const control = e.target.closest?.("button, .hud");
    if (!drag.moved && performance.now() - drag.t0 < 600 && !control) dropWave(ndcOf(e)); // a click drops the wave; on a control it does not
  });
  document.addEventListener("pointerleave", () => { ptr.has = false; });
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") goto(layerIdx + 1);
    else if (e.key === "ArrowLeft") goto(layerIdx - 1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= LAYERS.length) goto(Number(e.key) - 1);
    else if (e.key === "[") setPixel(pixel - 0.05);
    else if (e.key === "]") setPixel(pixel + 0.05);
    else if (e.key === "r" || e.key === "R") setRef(!refOn);
  });
  document.getElementById("prev").addEventListener("click", () => goto(layerIdx - 1));
  document.getElementById("next").addEventListener("click", () => goto(layerIdx + 1));
  ui.addEventListener("pointerover", (e) => { const t = e.target.closest("[data-id]"); hover = t ? Number(t.dataset.id) : 0; });
  ui.addEventListener("pointerout", () => { hover = 0; });
  ui.addEventListener("focusin", (e) => { const t = e.target.closest("[data-id]"); hover = t ? Number(t.dataset.id) : 0; });
  ui.addEventListener("focusout", () => { hover = 0; });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
    if (!f) return;
    try {
      picture = await pictureFromFile(f);
      cache.delete("picture");
      goto(LAYERS.indexOf("picture"));
    } catch (err) { console.warn(err); }
  });

  /** The reference: the real home, in a frame over the swarm, to compare the two (its own pointer, its own theme). */
  function setRef(on) {
    refOn = on;
    if (on && !refEl.getAttribute("src")) refEl.setAttribute("src", refEl.dataset.src);
    refEl.hidden = !on;
    canvas.style.visibility = on ? "hidden" : "";
    refBtn.setAttribute("aria-pressed", String(on));
    refBtn.textContent = on ? "ref: the home" : "ref: swarm";
    hud();
  }
  refBtn.addEventListener("click", () => setRef(!refOn));

  let urlTimer = 0, cellTimer = 0;
  function setPixel(g) {
    pixel = Math.min(1, Math.max(0, Math.round(g * 100) / 100));
    slider.value = String(pixel);
    clearTimeout(urlTimer); // (the URL follows the setting once it rests: replaceState a hundred times a second is throttled)
    urlTimer = setTimeout(() => {
      const u = new URL(location.href);
      if (pixel > 0) u.searchParams.set("pixel", String(pixel)); else u.searchParams.delete("pixel");
      history.replaceState(null, "", u);
    }, 300);
    clearTimeout(cellTimer); // the layers are built again for the new cell, and the pixels walk to it
    cellTimer = setTimeout(() => rebuild(), 250);
  }
  /** The grid changed (the pixel setting, the window): build the current layer for it, and the dots walk to the new cells. */
  function rebuild() {
    resize();
    goto(layerIdx);
  }
  slider.addEventListener("input", () => setPixel(Number(slider.value)));
  slider.value = String(pixel);
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 200);
  });

  const first = params.get("layer");
  const startIdx = first && LAYERS.includes(first) ? LAYERS.indexOf(first) : 0;
  nextName = LAYERS[startIdx];
  layerIdx = startIdx;
  upload(targets[cur], layerData(nextName)); // the first layer: the dots land in it from the scatter
  hud();
  if (matchMedia("(hover: hover) and (pointer: fine)").matches && !reduce) html.classList.add("live");
  html.classList.add("gl");

  let last = performance.now();
  function frame(now) {
    if (!refOn) {
      if (!paused) simulate((now - last) / 1000);
      draw();
    }
    last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // for tuning and for checking in the console: every number the look depends on, and a way to move time by hand
  window.__swarm = {
    goto, next: () => goto(layerIdx + 1), setPixel, setRef, wave: dropWave, rebuild,
    pause(on = true) { paused = on; }, // (freezes the clock; step() still moves it, draw() still draws)
    step(sec = 1) { for (let t = 0; t < sec; t += 1 / 60) simulate(1 / 60); draw(); },
    turn(yaw, pitch) { cam.yaw = yaw; cam.pitch = pitch; },
    info: () => ({ layer: nextName, from: prevName, since, pixel, cam: { ...cam }, waveT, cell: G.ctx.cell, cols: G.ctx.cols, rows: G.ctx.rows, dpr: G.dpr, reduce, time, ref: refOn }),
    /** lit share and mean level of the canvas, read back right after a draw (numbers before pictures) */
    stats(rect) { // rect: [x, y, w, h] in CSS px from the top left, or the whole canvas
      draw();
      const { viewW, viewH } = G.ctx, k = G.dpr;
      const [x, y, w, h] = rect ? rect.map((v) => Math.round(v * k)) : [0, 0, viewW, viewH];
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(x, viewH - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0, sum = 0;
      for (let i = 0; i < w * h; i++) { const v = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]); sum += v; if (v > 24) lit++; }
      return { lit: +(lit / (w * h)).toFixed(4), mean: +(sum / (w * h) / 255).toFixed(4) };
    },
    shot() { draw(); return canvas.toDataURL(); },
    walk,
    /**
     * the walk, as numbers read back from the GPU: how many dots are going out / walking / have arrived, how many of the walkers
     * are carriers, and how far the walkers are from the straight line between their two places (in cells; must be ~0)
     */
    walkStats() {
      const rb = gl.createFramebuffer(), out = {};
      gl.bindFramebuffer(gl.FRAMEBUFFER, rb);
      for (const k of ["pos", "from", "to"]) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state[read][k], 0);
        out[k] = new Float32Array(N * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out[k]);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(rb);
      const cw = G.ctx.cellWorld, h11 = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
      let going = 0, walking = 0, carriers = 0, arrived = 0, settled = 0, maxOff = 0, maxT = 0, minT = 0, backwards = 0;
      for (let i = 0; i < N; i++) {
        const p = out.from[i * 4 + 3];
        if (p >= 2) settled++;
        else if (p >= 1) arrived++;
        else if (p > 0.0001) {
          if (p < walk.pause) { going++; continue; }
          walking++;
          if (h11(i + 93.1) < walk.walkers) carriers++;
          const f = [0, 1, 2].map((a) => out.from[i * 4 + a]), t = [0, 1, 2].map((a) => out.to[i * 4 + a]), s = [0, 1, 2].map((a) => out.pos[i * 4 + a]);
          const d = t.map((v, a) => v - f[a]), L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          if (L2 < 1e-12) continue;
          const u = s.map((v, a) => v - f[a]), k = (u[0] * d[0] + u[1] * d[1] + u[2] * d[2]) / L2;
          const off = Math.hypot(...u.map((v, a) => v - k * d[a])) / cw;
          if (off > maxOff) maxOff = off;
          if (k > maxT) maxT = k;
          if (k < minT) minT = k;
          if (k < -1e-3 || k > 1 + 1e-3) backwards++;
        }
      }
      return { going, walking, carriers, carrierShare: walking ? carriers / walking : 0, arrived, settled, offLineCells: maxOff, alongMin: minT, alongMax: maxT, outOfSegment: backwards };
    },
  };
}

try {
  await Promise.all([document.fonts?.ready, loadWordmark()]);
  start();
} catch (err) {
  // no WebGL2 (or no float targets): the DOM on its own, the panel as plain HTML
  console.warn(err);
  canvas.remove();
  hudEl.textContent = "this experiment needs WebGL2: the panel above is the plain page";
}
