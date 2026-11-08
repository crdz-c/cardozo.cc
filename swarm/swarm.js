// cardozo.cc/swarm — one set of dots told to become an interface, a picture, a cube, a sphere, a column; click and they go, like a
// drone show. An experiment (docs/PLANKTON.md §14), not the home's interface.
//
// How it is built, in one paragraph. The dots are a W × H texture of positions and one of velocities, updated on the GPU every frame
// (update pass): each dot is a spring toward its *target*, with its own stiffness and damping, a swirl while it is far from it
// (so paths curve) and a moment of its own at which it leaves the old target for the new one (the wave from the click, plus noise).
// Targets are layers (layers.js: pure maths, sorted so that dot i is near dot i in the next layer). The draw pass reads the
// positions with gl_VertexID, projects them with a small orbit camera, and draws points, additive, on black. The pixel setting
// (density.js) decides what a point looks like: fine round dust, or big square cells on the screen's grid with few of them lit.
import { N, W, H, BODY, LAYERS, rng, dust, scatter, assemble, bitmapBody, cubeBody, sphereBody, columnBody, rotation } from "./layers.js";
import { pixelSetting } from "./density.js";

const html = document.documentElement;
const canvas = document.getElementById("scene");
const ui = document.getElementById("ui");
const slider = document.getElementById("pixel");
const nameEl = document.getElementById("layer-name");
const noEl = document.getElementById("layer-no");
const hudEl = document.getElementById("hud");
const params = new URLSearchParams(location.search);
// (?still shows the reduced-motion version on demand: the dots jump to their places, nothing moves)
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches || params.has("still");
const D = 3.2; // the camera's distance: at z = 0 the screen's height is 2 world units

// ------------------------------------------------------------------------------------------------ layers from the DOM and from pictures
const dustArr = dust();
let picture = null; // { bitmap, worldH }: the picture layer's source (a drawn one, or a dropped image)

function drawUI() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "middle";
  const regions = [];
  for (const el of ui.querySelectorAll("[data-id]")) {
    const cs = getComputedStyle(el), er = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    const tone = Number(el.dataset.tone || 1);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
    if (el.tagName === "BUTTON") {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(255,255,255,${tone})`;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(er.left + 0.75, er.top + 0.75, er.width - 1.5, er.height - 1.5, er.height / 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,255,255,${tone})`;
    ctx.fillText(el.textContent, tr.left, tr.top + tr.height / 2);
    regions.push({ id: Number(el.dataset.id), x: Math.floor(er.left), y: Math.floor(er.top), w: Math.ceil(er.width), h: Math.ceil(er.height) });
  }
  return { bitmap: ctx.getImageData(0, 0, w, h), regions };
}

/** The picture drawn when nothing was dropped: a bright core in a dark net, a flare, stars (after the references, not a copy). */
function drawCosmos() {
  const S = 640, c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const r = rng(9), cx = S / 2, cy = S * 0.52, TAU = Math.PI * 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.46);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#000";
  ctx.lineCap = "round";
  for (const [rx, ry, rot, lw] of [[230, 175, -0.35, 24], [200, 230, 0.5, 18], [250, 150, 1.2, 14]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = 8;
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 110, cy + Math.sin(a) * 110);
    ctx.lineTo(cx + Math.cos(a) * 270, cy + Math.sin(a) * 270);
    ctx.stroke();
  }
  const bar = (x, y, w, h, horizontal) => {
    const gr = horizontal ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,0.9)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, w, h);
  };
  bar(30, cy - 1.5, S - 60, 3, true);
  bar(cx - 1.5, 30, 3, S - 60, false);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * r()})`;
    ctx.beginPath();
    ctx.arc(r() * S, r() * S, 0.6 + Math.pow(r(), 3) * 2.2, 0, TAU);
    ctx.fill();
  }
  return { bitmap: ctx.getImageData(0, 0, S, S), worldH: 1.7 };
}

/** A dropped image becomes the picture: fitted, turned to grey, its levels stretched. It stays on this machine. */
async function pictureFromFile(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(900 / img.width, 900 / img.height, 1);
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const bm = ctx.getImageData(0, 0, w, h), d = bm.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  for (let i = 0; i < w * h; i++) {
    const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    const v = Math.max(0, Math.min(255, ((l - lo) / Math.max(1, hi - lo)) * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  const scale = Math.min(1.7 / h, 2.6 / w);
  return { bitmap: bm, worldH: h * scale };
}

const cache = new Map();
function build(name) {
  switch (name) {
    case "ui": {
      const { bitmap, regions } = drawUI();
      return bitmapBody(bitmap, { worldH: 2, count: 56000, thr: 0.2, baseTone: 0.92, regions, haze: [0.008, 0.3] }, 11);
    }
    case "cosmos": {
      picture ||= drawCosmos();
      return bitmapBody(picture.bitmap, { worldH: picture.worldH, count: 70000, gamma: 1.6, thr: 0.03, depth: 0.3, baseTone: 0.8, haze: [0.01, 0.4] }, 12);
    }
    case "cube": return cubeBody();
    case "sphere": return sphereBody();
    case "column": return columnBody();
    default: throw new Error(`no layer ${name}`);
  }
}
const layerData = (name) => {
  if (!cache.has(name)) cache.set(name, assemble(build(name), dustArr));
  return cache.get(name);
};

// ------------------------------------------------------------------------------------------------ the GPU
const FULLSCREEN = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// each dot is a spring toward its target; it leaves the old target at its own moment
const UPDATE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tPos, tVel, tPrev, tNext;
uniform ivec2 uTex;
uniform float uDt, uTime, uSince, uBody, uStill;
uniform vec2 uClick;
uniform mat3 uRotPrev, uRotNext;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  float fi = float(tc.x + tc.y * uTex.x);
  vec4 pos = texelFetch(tPos, tc, 0);
  vec4 vel = texelFetch(tVel, tc, 0);
  vec4 pv = texelFetch(tPrev, tc, 0);
  vec4 nx = texelFetch(tNext, tc, 0);
  bool body = fi < uBody;
  vec3 wp = body ? uRotPrev * pv.xyz : pv.xyz;
  vec3 wn = body ? uRotNext * nx.xyz : nx.xyz;
  float h1 = h11(fi), h2 = h11(fi + 17.3), h3 = h11(fi + 41.7);
  // the wave from the click reaches each dot's new place, and every dot adds a moment of its own
  float delay = distance(wn.xy, uClick) * 0.34 + h1 * 0.5;
  bool go = uSince > delay;
  vec3 target = go ? wn : wp;
  float w = go ? nx.w : pv.w;
  if (uStill > 0.5) { oPos = vec4(target, w); oVel = vec4(0.0); return; }
  vec3 d = target - pos.xyz;
  float dist = length(d);
  float k = 55.0 * (0.8 + 0.4 * h2);                                  // its own stiffness
  float c = 2.0 * 0.55 * sqrt(k) * (0.85 + 0.3 * h3);                  // its own damping: a little overshoot, then it settles
  vec3 acc = k * d - c * vel.xyz;
  vec3 n = vec3(sin(pos.y * 2.1 + uTime * 0.8 + h1 * 6.28) + sin(pos.z * 1.7 - uTime),
                sin(pos.z * 2.3 + uTime * 0.6) + sin(pos.x * 1.9 + uTime * 0.9 + h2 * 6.28),
                sin(pos.x * 2.7 - uTime * 0.7) + sin(pos.y * 1.5 + uTime * 0.5));
  acc += cross(d / (dist + 1e-3), n) * 16.0 * smoothstep(0.05, 0.9, dist); // far from home it swirls: the path curves
  vec3 v = vel.xyz + acc * uDt;
  float sp = length(v);
  if (sp > 4.0) v *= 4.0 / sp;
  oPos = vec4(pos.xyz + v * uDt, w);
  oVel = vec4(v, 0.0);
}`;

const DRAW_V = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D tPos, tVel;
uniform ivec2 uTex;
uniform float uYaw, uPitch, uD, uAspect, uTime, uDpr, uHover, uPtrE, uCell, uKeep, uSnap, uAlpha, uPower, uDust, uBody;
uniform vec2 uView, uPtr;
uniform vec3 uShock;
out float vA;
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uTex.x, id / uTex.x);
  vec4 s = texelFetch(tPos, tc, 0);
  vec3 vel = texelFetch(tVel, tc, 0).xyz;
  float fid = floor(s.w);
  float tone = s.w - fid;
  float fi = float(id);
  float h1 = h11(fi), h2 = h11(fi + 17.3), h3 = h11(fi + 41.7);
  if (h1 > uKeep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; } // thinned by rank
  vec3 p = s.xyz + 0.004 * vec3(sin(uTime * 0.9 + h1 * 6.283), sin(uTime * 1.1 + h2 * 6.283), sin(uTime * 0.7 + h3 * 6.283));
  float cy = cos(uYaw), sy = sin(uYaw), cx = cos(uPitch), sx = sin(uPitch);
  vec3 q = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  q = vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
  float depth = uD - q.z;
  vec2 ndc = vec2(q.x / uAspect, q.y) * uD / depth;
  vec2 a = vec2(uAspect, 1.0);
  // the pointer: a hole in the dots with a push round it; moving it stirs more
  vec2 dd = (ndc - uPtr) * a;
  float r = length(dd);
  ndc += (dd / (r + 1e-4)) * exp(-pow(r / 0.2, 2.0)) * (0.05 + 0.1 * uPtrE) / a;
  float hole = 1.0 - 0.9 * exp(-pow(r / 0.05, 2.0));
  // the click: a ring that runs out from it
  vec2 sd = (ndc - uShock.xy) * a;
  float ring = exp(-pow((length(sd) - uShock.z * 1.5) / 0.14, 2.0)) * exp(-uShock.z * 1.6);
  ndc += (sd / (length(sd) + 1e-4)) * ring * 0.06 / a;
  float hot = (fid > 0.5 && abs(fid - uHover) < 0.5) ? 1.0 : 0.0;
  float speed = length(vel);
  tone = clamp(tone + 0.3 * hot + 0.45 * smoothstep(0.4, 2.5, speed), 0.0, 1.0); // a dot in flight glows
  tone = pow(tone, uPower);                                                      // (lifts the dim ones at the grid end)
  float tw = 0.78 + 0.22 * sin(uTime * (0.8 + 2.2 * h2) + h3 * 6.283);
  float fog = clamp(0.55 + 0.35 * q.z, 0.35, 1.0);
  vec2 px = (ndc * 0.5 + 0.5) * uView;
  px = mix(px, (floor(px / uCell) + 0.5) * uCell, uSnap);
  ndc = px / uView * 2.0 - 1.0;
  float fine = (0.9 + 1.7 * tone) * uDpr * clamp(uD / depth, 0.6, 1.8) * (1.0 + 0.25 * hot);
  float coarse = max(1.0, uCell - max(1.0, 0.09 * uCell));
  gl_PointSize = mix(fine, coarse, uSnap);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vA = tone * tw * fog * hole * uAlpha * (fi >= uBody ? uDust : 1.0);
}`;

const DRAW_F = `#version 300 es
precision highp float;
uniform float uSquare;
in float vA;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = mix(length(c), max(abs(c.x), abs(c.y)), uSquare);
  float a = smoothstep(1.0, mix(0.35, 0.9, uSquare), d) * vA;
  o = vec4(0.94, 0.935, 0.9, a);
}`;

// the screen's own grid, faintly, behind the dots: one tile per cell, each with a slow life of its own
const GRID_F = `#version 300 es
precision highp float;
uniform float uCell, uGrid, uTime;
out vec4 o;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 f = fract(gl_FragCoord.xy / uCell);
  float gap = max(1.0, 0.09 * uCell) / uCell * 0.5;
  float inside = step(gap, f.x) * step(gap, f.y) * step(f.x, 1.0 - gap) * step(f.y, 1.0 - gap);
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
  const start0 = assemble(scatter(), dustArr);
  const state = [0, 1].map(() => {
    const pos = f32(start0), vel = f32(new Float32Array(N * 4));
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("incomplete framebuffer");
    return { pos, vel, fbo };
  });
  const targets = [f32(start0), f32(layerData("ui"))];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // ---- the world's state
  let read = 0, cur = 1; // state[read] is the latest; targets[cur] is the next layer, targets[1 - cur] the previous
  let prevName = "scatter", nextName = "ui", layerIdx = 0;
  let time = 0, since = 0, shockT = 9, click = [0, 0], shockNdc = [9, 9];
  let hover = 0, pixel = Math.min(1, Math.max(0, Number(params.get("pixel")) || 0));
  const ptr = { x: 9, y: 9, sx: 9, sy: 9, e: 0, has: false };
  const cam = { yaw: 0, pitch: 0 };
  let dpr = 1, cw = 1, ch = 1;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cw = Math.max(1, Math.round(innerWidth * dpr));
    ch = Math.max(1, Math.round(innerHeight * dpr));
    canvas.width = cw;
    canvas.height = ch;
  }

  function simulate(dt) {
    const e = Math.min(dt, 1 / 30);
    time += reduce ? 0 : e;
    since += e;
    shockT += e;
    // pointer: smoothed, and the speed of it is the energy
    if (ptr.has) {
      const lx = ptr.sx, ly = ptr.sy, k = 1 - Math.exp(-e * 16);
      ptr.sx = ptr.sx > 8 ? ptr.x : ptr.sx + (ptr.x - ptr.sx) * k;
      ptr.sy = ptr.sy > 8 ? ptr.y : ptr.sy + (ptr.y - ptr.sy) * k;
      ptr.e = Math.min(1, ptr.e + Math.min(Math.hypot(ptr.sx - lx, ptr.sy - ly) / Math.max(e, 1e-3), 6) * e * 0.5);
    }
    ptr.e *= Math.exp(-e / 1.4);
    const cyaw = ptr.has && !reduce ? ptr.sx * 0.1 : 0, cpitch = ptr.has && !reduce ? -ptr.sy * 0.07 : 0;
    cam.yaw += (cyaw - cam.yaw) * (1 - Math.exp(-e * 3));
    cam.pitch += (cpitch - cam.pitch) * (1 - Math.exp(-e * 3));

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
    bind(1, src.vel, "tVel");
    bind(2, targets[1 - cur], "tPrev");
    bind(3, targets[cur], "tNext");
    gl.uniform2i(upd.u.uTex, W, H);
    gl.uniform1f(upd.u.uDt, e);
    gl.uniform1f(upd.u.uTime, time);
    gl.uniform1f(upd.u.uSince, since);
    gl.uniform1f(upd.u.uBody, BODY);
    gl.uniform1f(upd.u.uStill, reduce ? 1 : 0);
    gl.uniform2f(upd.u.uClick, click[0], click[1]);
    gl.uniformMatrix3fv(upd.u.uRotPrev, false, rotation(prevName, time));
    gl.uniformMatrix3fv(upd.u.uRotNext, false, rotation(nextName, time));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    read = 1 - read;
  }

  function draw() {
    const s = pixelSetting(pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const cell = Math.max(2, s.cell * dpr);
    if (s.grid > 0 && params.get("gridlines") !== "0") {
      gl.useProgram(grd.p);
      gl.uniform1f(grd.u.uCell, cell);
      gl.uniform1f(grd.u.uGrid, s.grid);
      gl.uniform1f(grd.u.uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(drw.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state[read].pos);
    gl.uniform1i(drw.u.tPos, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state[read].vel);
    gl.uniform1i(drw.u.tVel, 1);
    gl.uniform2i(drw.u.uTex, W, H);
    gl.uniform1f(drw.u.uYaw, cam.yaw);
    gl.uniform1f(drw.u.uPitch, cam.pitch);
    gl.uniform1f(drw.u.uD, D);
    gl.uniform1f(drw.u.uAspect, cw / ch);
    gl.uniform1f(drw.u.uTime, time);
    gl.uniform1f(drw.u.uDpr, dpr);
    gl.uniform1f(drw.u.uHover, nextName === "ui" ? hover : 0);
    gl.uniform1f(drw.u.uPtrE, ptr.e);
    gl.uniform1f(drw.u.uCell, cell);
    gl.uniform1f(drw.u.uPower, s.power);
    gl.uniform1f(drw.u.uDust, s.dust);
    gl.uniform1f(drw.u.uBody, BODY);
    gl.uniform1f(drw.u.uKeep, s.keep);
    gl.uniform1f(drw.u.uSnap, s.snap);
    gl.uniform1f(drw.u.uSquare, s.square);
    gl.uniform1f(drw.u.uAlpha, 0.55 * s.gain);
    gl.uniform2f(drw.u.uView, cw, ch);
    gl.uniform2f(drw.u.uPtr, ptr.has ? ptr.sx : 9, ptr.has ? ptr.sy : 9);
    gl.uniform3f(drw.u.uShock, shockNdc[0], shockNdc[1], shockT);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.disable(gl.BLEND);
  }

  // ---- the interface the layers are told to become
  function hud() {
    nameEl.textContent = nextName;
    noEl.textContent = `${layerIdx + 1}/${LAYERS.length}`;
    ui.inert = nextName !== "ui"; // the interface is only there while its layer is
  }
  function goto(i, ndc = [0, 0]) {
    layerIdx = ((i % LAYERS.length) + LAYERS.length) % LAYERS.length;
    prevName = nextName;
    nextName = LAYERS[layerIdx];
    cur = 1 - cur; // the texture that held the previous layer now holds the new one; the old "next" is the new "previous"
    upload(targets[cur], layerData(nextName));
    since = 0;
    shockT = 0;
    click = [ndc[0] * (cw / ch), ndc[1]]; // at z = 0 the world is the screen: x in aspect units, y in [-1, 1]
    shockNdc = ndc;
    hover = 0;
    hud();
  }
  const ndcOf = (e) => [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2];

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const [x, y] = ndcOf(e);
    ptr.x = x;
    ptr.y = y;
    ptr.has = true;
  });
  document.addEventListener("pointerleave", () => { ptr.has = false; });
  addEventListener("click", (e) => {
    if (e.target.closest?.(".hud")) return;
    goto(layerIdx + 1, e.detail === 0 ? [0, 0] : ndcOf(e)); // a click or a tap; Enter on a button has no position
  });
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight") goto(layerIdx + 1);
    else if (e.key === "ArrowLeft") goto(layerIdx - 1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= LAYERS.length) goto(Number(e.key) - 1);
    else if (e.key === "[") setPixel(pixel - 0.05);
    else if (e.key === "]") setPixel(pixel + 0.05);
  });
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
      cache.delete("cosmos");
      goto(LAYERS.indexOf("cosmos"), ndcOf(e));
    } catch (err) { console.warn(err); }
  });

  function setPixel(g) {
    pixel = Math.min(1, Math.max(0, Math.round(g * 100) / 100));
    slider.value = String(pixel);
    clearTimeout(urlTimer); // (the URL follows the setting once it rests: replaceState a hundred times a second is throttled)
    urlTimer = setTimeout(() => {
      const u = new URL(location.href);
      if (pixel > 0) u.searchParams.set("pixel", String(pixel)); else u.searchParams.delete("pixel");
      history.replaceState(null, "", u);
    }, 300);
  }
  let urlTimer = 0;
  slider.addEventListener("input", () => setPixel(Number(slider.value)));
  slider.value = String(pixel);

  let resizeTimer = 0;
  addEventListener("resize", () => {
    resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { // the interface is laid out by CSS: when the layout moves, the dots go to the new places
      cache.delete("ui");
      if (nextName === "ui") upload(targets[cur], layerData("ui"));
    }, 150);
  });

  resize();
  hud();
  const initial = params.get("layer");
  if (initial && LAYERS.includes(initial)) goto(LAYERS.indexOf(initial));
  if (matchMedia("(hover: hover) and (pointer: fine)").matches && !reduce) html.classList.add("live");
  html.classList.add("gl");

  let last = performance.now(), paused = false;
  function frame(now) {
    if (!paused) simulate((now - last) / 1000);
    last = now;
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // for tuning and for checking in the console: every number the page's look depends on, and a way to move time by hand
  window.__swarm = {
    goto, next: () => goto(layerIdx + 1), setPixel,
    pause(on = true) { paused = on; }, // (freezes the clock; step() still moves it, draw() still draws)
    step(sec = 1) { for (let t = 0; t < sec; t += 1 / 60) simulate(1 / 60); draw(); },
    info: () => ({ layer: nextName, from: prevName, since, pixel, setting: pixelSetting(pixel), cw, ch, dpr, reduce, time }),
    /** lit share and mean level of the canvas, read back right after a draw (numbers before pictures) */
    stats() {
      draw();
      const px = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0, sum = 0;
      for (let i = 0; i < cw * ch; i++) { const v = px[i * 4]; sum += v; if (v > 24) lit++; }
      return { lit: lit / (cw * ch), mean: sum / (cw * ch) / 255 };
    },
    shot() { draw(); return canvas.toDataURL(); },
  };
}

try {
  await document.fonts?.ready;
  start();
} catch (err) {
  // no WebGL2 (or no float targets): the DOM on its own, the interface as plain HTML
  console.warn(err);
  canvas.remove();
  hudEl.textContent = "this experiment needs WebGL2: the interface above is the plain page";
}
