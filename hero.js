// cardozo.cc hero — boot sequence, dithered orb (WebGL), pointer-reactive wordmark.
// No dependencies. Everything degrades: without WebGL the page keeps the frame, type and logo;
// with prefers-reduced-motion it renders a single still frame and skips the boot.

const html = document.documentElement;
const hero = document.getElementById("hero");
const canvas = hero.querySelector(".orb");
const logoSvg = hero.querySelector(".logo svg");
const letters = [...hero.querySelectorAll(".lt")];

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(hover: none)").matches;

const INK = [5 / 255, 5 / 255, 5 / 255];
const PAPER = [242 / 255, 242 / 255, 238 / 255];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : orb grows from a seed
  pxMul: reduce ? 1 : 5, // dither cell multiplier : coarse → fine as the orb "resolves"
  hover: 0,
  mouse: [0.34, 0.16],
  target: [0.34, 0.16],
  lastPointer: -1e9,
  inside: false,
  time: reduce ? 4 : 0,
  orb: [0.2, 0.08, 0.28], // centre x/y and radius, in units of hero height (y up)
  clipY: -1,
};

// Measure the free space and park the orb in it: right of the headline on landscape,
// above the headline on portrait. Uses the real DOM, so it follows font loading and resizes.
function layoutOrb() {
  const hr = hero.getBoundingClientRect();
  const W = hr.width;
  const H = hr.height;
  const rel = (sel) => hero.querySelector(sel).getBoundingClientRect();
  const top = rel(".bar--top").bottom - hr.top + 6;
  const logo = rel(".logo");
  const logoTop = logo.top - hr.top;

  let cx, cy, r, clip;
  if (W / H >= 1.15) {
    const bottom = logoTop + logo.height * 0.22; // sinks slightly behind the wordmark
    r = Math.min((bottom - top) / 2, W * 0.26);
    cx = Math.min(W * 0.66, W - r - 40);
    cy = (top + bottom) / 2;
    clip = logoTop - 4; // halo and stars stay off the wordmark
  } else {
    const eyebrowTop = rel(".eyebrow").top - hr.top;
    const bottom = eyebrowTop - 16;
    r = Math.min((bottom - top) / 2, W * 0.42);
    cx = W / 2;
    cy = (top + bottom) / 2;
    clip = eyebrowTop - 10; // ...and off the headline
  }
  state.orb = [(cx - W / 2) / H, (H / 2 - cy) / H, Math.max(r, 20) / H];
  state.clipY = (H / 2 - clip) / H;
  hero.style.setProperty("--ox", `${cx}px`);
  hero.style.setProperty("--oy", `${cy}px`);
}

// ------------------------------------------------------------------ orb (WebGL)
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
uniform vec3  uOrb;
uniform float uClipY;
uniform vec3  uInk;
uniform vec3  uPaper;
uniform sampler2D uBayer;

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
  float a = mix(hash(i),                    hash(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}

float fbm(vec3 p) {
  return vnoise(p) * 0.65 + vnoise(p * 2.3 + 7.1) * 0.35;
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// surface texture, in the orb's own (rotating) space
float field(vec3 n, float ay, float ax, float t) {
  vec3 q = n;
  q.xz = rot(ay) * q.xz;
  q.yz = rot(ax) * q.yz;
  return fbm(q * 1.7 + vec3(0.0, 0.0, t * 0.16));
}

void main() {
  vec2 frag = gl_FragCoord.xy;

  // lens: the dither grid gets finer around the pointer
  vec2 mpx = (uMouse * 0.5 + 0.5) * uRes;
  float dm = length(frag - mpx) / uRes.y;
  float k = smoothstep(0.03, 0.24, dm / (0.45 + uHover * 0.55));
  float px = max(1.0, floor(uPx * mix(0.4, 1.0, k)));

  vec2 cell = floor(frag / px);
  vec2 c = (cell + 0.5) * px;

  float aspect = uRes.x / uRes.y;
  vec2 uv = (c - 0.5 * uRes) / uRes.y;

  // placement comes from the page layout (JS measures the free space): xy = centre, z = radius
  vec2 oc = uOrb.xy;
  float R0 = uOrb.z;
  float R  = mix(0.02, R0, uIntro);

  vec2 p = uv - oc;
  float r = length(p);
  float ang = atan(p.y, p.x);

  // organic silhouette
  float wob = vnoise(vec3(cos(ang) * 1.4, sin(ang) * 1.4, uTime * 0.22)) - 0.5;
  float edge = R * (1.0 + 0.16 * wob * (0.55 + uHover * 0.8));

  float lum = 0.0;

  if (r < edge) {
    float z = sqrt(max(0.0, 1.0 - (r / edge) * (r / edge)));
    vec3 n = vec3(p / edge, z);

    float ay = uTime * 0.12 + uMouse.x * 0.9;
    float ax = uMouse.y * 0.5 - 0.2;

    float e = 0.1;
    float b0 = field(n, ay, ax, uTime);
    vec3 grad = vec3(
      field(n + vec3(e, 0.0, 0.0), ay, ax, uTime) - b0,
      field(n + vec3(0.0, e, 0.0), ay, ax, uTime) - b0,
      field(n + vec3(0.0, 0.0, e), ay, ax, uTime) - b0
    ) / e;
    vec3 nb = normalize(n - grad * (0.42 + uHover * 0.3));

    vec3 l = normalize(vec3(uMouse.x * 1.2 - 0.35, uMouse.y * 1.0 + 0.55, 0.85));
    float diff = max(dot(nb, l), 0.0);
    float rim  = pow(1.0 - max(n.z, 0.0), 3.0);
    float band = 0.06 * sin(dot(n, vec3(9.0, 7.0, 5.0)) + uTime * 0.6);

    lum = 0.05 + diff * 0.82 + rim * 0.3 + band;
  } else {
    // halo + a sparse, twinkling star field, all through the same dither
    float halo = max(0.0, 0.17 * exp(-r * 3.2) - 0.045);
    float star = step(0.9975, hash2(cell));
    float tw = 0.5 + 0.5 * sin(uTime * 2.0 + cell.x * 0.7);
    // keep specks off the type (and off the wordmark, where the difference blend would turn them into dark flecks)
    float clear = smoothstep(uClipY - 0.05, uClipY + 0.02, uv.y);
    lum = (halo + star * 0.55 * tw) * uIntro * clear;
  }

  float threshold = texture2D(uBayer, (mod(cell, 8.0) + 0.5) / 8.0).r;
  float on = step(threshold, clamp(lum, 0.0, 1.0) * 0.98);
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

function createOrb() {
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

  // 8×8 Bayer threshold map
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 8, 8, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bayerBytes(8));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const u = (name) => gl.getUniformLocation(prog, name);
  const U = {
    res: u("uRes"), time: u("uTime"), mouse: u("uMouse"), hover: u("uHover"),
    intro: u("uIntro"), px: u("uPx"), orb: u("uOrb"), clipY: u("uClipY"),
  };
  gl.uniform3fv(u("uInk"), INK);
  gl.uniform3fv(u("uPaper"), PAPER);
  gl.uniform1i(u("uBayer"), 0);

  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
  const basePx = (coarse ? 4 : 5) * dpr;

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.res, canvas.width, canvas.height);
  };
  new ResizeObserver(() => {
    resize();
    draw();
  }).observe(canvas);
  resize();

  function draw() {
    gl.uniform1f(U.time, state.time);
    gl.uniform2f(U.mouse, state.mouse[0], state.mouse[1]);
    gl.uniform1f(U.hover, state.hover);
    gl.uniform1f(U.intro, state.intro);
    gl.uniform1f(U.px, basePx * state.pxMul);
    gl.uniform3f(U.orb, state.orb[0], state.orb[1], state.orb[2]);
    gl.uniform1f(U.clipY, state.clipY);
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
    pointerLogo(e);
  },
  { passive: true }
);
html.addEventListener("pointerleave", () => {
  state.inside = false;
  logoWave.mx = null;
});

// ------------------------------------------------------------------ wordmark wave
// Letters lift softly toward the pointer (and breathe a little when idle).
const logoWave = { mx: null, strength: 0, lifts: letters.map(() => 0), centers: [] };

function measureLetters() {
  logoWave.centers = letters.map((g) => {
    const b = g.getBBox();
    return b.x + b.width / 2;
  });
}
measureLetters();

function pointerLogo(e) {
  const r = logoSvg.getBoundingClientRect();
  logoWave.mx = ((e.clientX - r.left) / r.width) * 90;
  const dy = Math.abs(e.clientY - (r.top + r.height / 2));
  logoWave.strength = clamp01(1 - dy / (hero.clientHeight * 0.55));
}

function updateLogo(t, k = 0.1) {
  letters.forEach((g, i) => {
    let target = 0;
    if (logoWave.mx !== null) {
      const d = logoWave.centers[i] - logoWave.mx;
      target = -0.62 * logoWave.strength * Math.exp(-(d * d) / (2 * 13 * 13));
    }
    if (!reduce) target += -0.07 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 0.95));
    logoWave.lifts[i] = lerp(logoWave.lifts[i], target, k);
    g.setAttribute("transform", `translate(0 ${logoWave.lifts[i].toFixed(3)})`);
  });
}

// ------------------------------------------------------------------ loop
const orb = createOrb();
if (orb) html.classList.add("gl");

layoutOrb();
new ResizeObserver(() => {
  layoutOrb();
  measureLetters();
  if (reduce) orb?.draw();
}).observe(hero);
document.fonts?.ready.then(() => {
  layoutOrb();
  measureLetters();
});

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

  // when nobody is steering, the orb slowly looks around by itself
  const idle = now - state.lastPointer > 2600;
  const tx = idle ? 0.34 + 0.3 * Math.sin(state.time * 0.23) : state.target[0];
  const ty = idle ? 0.14 + 0.2 * Math.cos(state.time * 0.19) : state.target[1];
  state.mouse[0] += ease(0.06) * (tx - state.mouse[0]);
  state.mouse[1] += ease(0.06) * (ty - state.mouse[1]);
  state.hover += ease(0.04) * ((state.inside && !idle ? 1 : 0) - state.hover);

  orb?.draw();
  updateLogo(state.time, ease(0.1));
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
    orb?.draw();
    updateLogo(0);
    return;
  }

  requestAnimationFrame(frame);

  if (seen && !forced) {
    // returning visitor: skip the console, keep the settle-in
    html.classList.add("quick", "framed");
    await tween(900, (t) => {
      state.intro = easeOutCubic(t);
      state.pxMul = lerp(3, 1, easeOutCubic(t));
    });
    html.classList.remove("booting");
    html.classList.add("ready");
    return;
  }

  const count = hero.querySelector("[data-count]");
  const bar = hero.querySelector("[data-bar]");
  const lines = [...hero.querySelectorAll(".boot__log li")];

  html.classList.add("framed");
  lines.forEach((li, i) => setTimeout(() => li.classList.add("on"), 250 + i * 380));

  await tween(2000, (t) => {
    const e = easeInOutCubic(t);
    count.textContent = String(Math.round(e * 100)).padStart(3, "0");
    bar.style.transform = `scaleX(${e})`;
    state.intro = easeOutCubic(clamp01(t * 1.05));
    state.pxMul = lerp(5, 1, easeOutCubic(t));
  });

  html.classList.add("boot-done");
  await new Promise((r) => setTimeout(r, 260));
  html.classList.remove("booting");
  html.classList.add("ready");

  try {
    sessionStorage.setItem("cc-boot", "1");
  } catch {
    /* storage unavailable: the boot simply plays again next time */
  }
}

boot();
