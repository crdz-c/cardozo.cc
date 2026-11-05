// cardozo.cc/lab — the hero's dot material with nothing else on screen, on a model you can turn.
//
// hero.js draws one thing: a wordmark made of dots over a field of dots. This page keeps that material (the same blue-noise
// dither, the same dots on a checkerboard lattice, the same flicker and twinkle, the calm sea of the ambient field, the way
// dots land when something appears, the wave a click sends) and takes everything else away: no wordmark, links, curtain,
// theme switch or zoom. In their place there is a plate in 3D: a disc (the CD, with its hole and its edge) or a card
// (any picture, video loop, animated GIF, or a sketch in JS) that you turn with the pointer.
//
// How it works. The plate is not a mesh: for every dither cell the FIELD pass casts a ray from a perspective camera, finds
// where it meets the plate (a face, the rim, the wall of the hole, the edge of a card), reads the texture there and takes its
// luminance as tone, which the hero's dots print as density. So the 3D is made of the same cells as everything else, and the
// dither stays fixed to the screen while the model turns under it. COMPOSE then blows the cells up to exact squares.
//
// Turn it: drag (it keeps gliding when you let go), wheel or pinch to dolly, arrows, R for the home pose. A click or tap
// (a press that does not move) sends the hero's wave: two pulses that push the dots, swell them and cancel their energy as
// they pass, then the sea settles. Put things on it: ?src=<url> (image, gif, mp4/webm), drop or paste a file on the page,
// or window.__lab.sketch(fn). Knobs are query parameters and live in window.__lab.P (see README, "Lab").
import { blueNoise } from "../raster.js";

const canvas = document.getElementById("scene");
const q = new URLSearchParams(location.search);
const num = (k, d) => {
  const v = parseFloat(q.get(k));
  return Number.isFinite(v) ? v : d;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);

const DEFAULT_SRC = "media/cd.png";
const DEFAULT_SPIN = 40; // deg/s: one turn in 9 s
const CD_HOLE = 0.118; // the CD's hole, × its radius (measured on the sprite)
const CD_HALF = 1.0964; // the sprite's half side, × the disc's radius (the disc fills 92 % of it)
const P = {
  src: q.get("src") || DEFAULT_SRC,
  spin: num("spin", 0), // deg/s about the plate's own axis, positive = clockwise. Unless ?spin= is given, the CD turns (DEFAULT_SPIN) and whatever replaces it stands still
  size: num("size", 0.8), // contain: the plate's share of the screen at home (a disc: its diameter over the screen's shorter side)
  fit: q.get("fit") === "cover" ? "cover" : "contain", // cover: a card fills the screen at home
  rx: num("rx", 26), // the home pose: tilt back (deg)…
  ry: num("ry", -20), // …and turn sideways (deg)
  thick: num("thick", 0.03), // the plate's thickness, × the disc's radius (a real CD is 0.02)
  shade: num("shade", 0.35), // a face turned away from you gets this much darker (0 = flat)
  cell: num("cell", 1.2), // CSS px per dither cell (the hero's is ~1.2 on a desktop; never under 2 device px)
  dens: num("dens", 1.2), // share of lattice sites lit at full tone; above 1 the brightest tones saturate to a solid checkerboard (the hero's letters: 0.72)
  gamma: num("gamma", 1), // tone curve: > 1 darker mid-tones, < 1 lighter
  black: num("black", 0.3), // levels: the tone that prints nothing (the CD's body sits between 0.5 and 0.72, so it needs stretching)…
  white: num("white", 0.9), // …and the tone that prints full
  lattice: num("lattice", 1), // 1: bright areas sit on the checkerboard (dots never fuse, the hero's letters); 0: free blue noise
  field: num("field", 1), // the ambient field of dots round the plate, 0 … 1
  color: num("color", 0), // 0: paper-white dots (the hero); 1: each dot takes its source's hue
  flicker: num("flicker", 1), // depth of the picture's flicker, × the hero's
  build: num("build", 2.8), // s: the dots land in when a source appears (0 = no build)
};

// camera and gestures
const FOCAL = 2; // the camera's focal length, in units of the screen's shorter side (the disc's radius is 1)
const ROT_PER_SIDE = 3.4; // rad: dragging across the screen's shorter side turns the model this far
const FRICTION = 4; // 1/s: how fast a released turn slows
const FOLLOW_DRAG = 26; // 1/s: the shown pose follows the dragged one (fluid, a little behind)…
const FOLLOW_COAST = 14; // …and the gliding one
const MAX_SPIN_RATE = 16; // rad/s: the fastest a flick may leave the model turning
const LZ_MIN = -0.85; // dolly limits, in log units (± ≈ 2.3× out, 2.6× in)
const LZ_MAX = 0.95;
const ZOOM_WHEEL = 0.0018; // log-dolly per wheel pixel: scrolling "down" moves in, as on the hero…
const ZOOM_WHEEL_PINCH = 0.012; // …and per pixel of a trackpad pinch (a wheel with ctrlKey: fingers apart moves in)
const ZOOM_FOLLOW = 14;
const MOUSE_SLOP = 4; // CSS px a press must move to be a turn instead of a tap
const TOUCH_SLOP = 10;
const TAP_MS = 450;

// the wave (the hero's numbers)
const WAVE_LIFE = 3.2; // s: a wave's whole life
const WAVE_PULSES = 2; // a tap sends this many pulses…
const WAVE_PULSE_GAP = 0.2; // …this many seconds apart…
const WAVE_PULSE_DECAY = 0.15; // …each this much weaker than the one before
const MAX_WAVES = 8;
const AFTERGLOW = 2.8; // s: decay time of the stirred-up energy (the sea's swell)

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

// The hero's FIELD shader, minus what is not material (no wordmark, pointer, curtain, theme, zoom), with a plate in 3D where
// the letters were. The numbers are the hero's.
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
#define SEA_STIR 4.0       // extra drift near the last wave, × energy, cells
#define SEA_GLOBAL 1.2     // extra drift everywhere, × energy, cells
#define SEA_SCALE 0.3      // swell size, screen heights
#define SEA_SPEED 0.05     // swell speed
#define SEA_RIPPLE 0.07    // ripple frequency, per cell (about 14-cell clusters)
#define BUILD_GAIN 1.03    // arrival rate (>= 1 so every site has arrived when the build ends)
#define FLASH 0.06         // a dot flashes bright on arrival, fading over this much of the build
#define WAVE_SPEED 1.05    // screen heights per second (passes the farthest corner within its life)
#define WAVE_WIDTH 0.1     // screen heights: the ring's half-width (a long, smooth swell)
#define WAVE_PUSH 0.008    // screen heights: how far the ring displaces the dots (gentle)
#define WAVE_DENS 0.4      // density/brightness swell at the ring (a quiet ripple, not an event)
#define WREV_LEAD 0.1      // behind the front the field thins: it rises over this…
#define WREV_HOLD 0.36     // …holds until here (screen heights behind the front)…
#define WREV_TAIL 0.5      // …and comes back over this
#define WREV_THIN 0.65     // the field thins this much while the wave is behind it
#define WNULL_AT 0.07      // right behind the front the dots' energy is cancelled: where…
#define WNULL_W 0.05       // …how wide…
#define WNULL 0.9          // …how deep
#define BG vec3(0.0)                       // true black…
#define FG vec3(0.9412, 0.9373, 0.9176)    // …and paper #f0efea

uniform vec2  uCells;     // field size, in cells
uniform float uCell;      // device px per cell
uniform vec2  uDev;       // canvas size, device px
uniform float uTime;
uniform float uIntro;     // the build, 0 … 1
uniform vec4  uA;         // density, gamma, black, white
uniform vec4  uB;         // lattice, field, colour, flicker
uniform vec4  uP;         // the camera's focal length, its distance, the plate's half thickness, face shading
uniform vec4  uPlate;     // half extents x, y, the hole's radius, shape (0 a disc, 1 a card)
uniform vec2  uHalf;      // the texture's half extent, in plate units
uniform mat3  uM;         // plate → world
uniform mat3  uMt;        // world → plate
uniform vec4  uW[${MAX_WAVES}];     // waves: x, y (device px), age (s, < 0 = off), amplitude
uniform vec3  uSea;       // calm-sea drift: amplitude (cells), stir x, y (device px)
uniform float uEnergy;    // stirred-up energy 0..1 (afterglow)
uniform sampler2D uBlue;
uniform sampler2D uTex;   // the plate's picture

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

// how the waves push the field: the displacement (device px) to subtract from a sample position, and in .z the extra density
// where the field is compressed
vec3 pushAt(vec2 p) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    vec2 dw = p - w.xy;
    float rw = length(dw) + 0.001;
    float front = w.z * WAVE_SPEED * uDev.y;
    float x = (rw - front) / (WAVE_WIDTH * uDev.y);
    float r0 = exp(-x * x);   // one long, quiet ring
    o.xy += dw / rw * r0 * w.w * WAVE_PUSH * uDev.y;
    o.z += r0 * w.w * WAVE_DENS;
  }
  return o;
}
// the wave's passage: x = how much the field has thinned behind the front, y = the band right behind it where the dots' energy is cancelled
vec2 waveAt(vec2 p) {
  vec2 o = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    float dn = (w.z * WAVE_SPEED * uDev.y - length(p - w.xy)) / uDev.y;
    float amp = smoothstep(0.0, 0.3, w.w);
    float rev = smoothstep(0.0, WREV_LEAD, dn) * (1.0 - smoothstep(WREV_HOLD, WREV_HOLD + WREV_TAIL, dn)) * amp;
    float nul = exp(-pow((dn - WNULL_AT) / WNULL_W, 2.0)) * amp;
    o = max(o, vec2(rev, nul));
  }
  return o;
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
  vec2 pDev = (cell + 0.5) * uCell;
  vec3 push = pushAt(pDev);
  vec2 c = (pDev - push.xy) / uCell;           // where this cell samples the scene from (displaced by a wave), in cells
  vec2 lc = 0.5 * uCells;
  float th = blue(cell);                       // the cell's dither threshold…
  float th2 = blue(cell + vec2(29.0, 13.0));   // …and its own moment of arrival

  // calm sea: a slow, low-frequency swell of the field. A wave's energy makes it larger and livelier, most around where the
  // wave began, then it settles back; the plate drifts only a little.
  vec2 sp = c / (SEA_SCALE * uCells.y);
  vec2 sea = vec2(vnoise(vec3(sp, uTime * SEA_SPEED)), vnoise(vec3(sp + 7.7, uTime * SEA_SPEED + 3.1))) - 0.5;
  vec2 chop = vec2(vnoise(vec3(sp * 2.6, uTime * 0.3)), vnoise(vec3(sp * 2.6 + 4.2, uTime * 0.3 + 1.9))) - 0.5;
  float stirW = exp(-pow(length(pDev - uSea.yz) / (0.45 * uDev.y), 2.0));
  float stirAmp = uEnergy * (SEA_STIR * stirW + SEA_GLOBAL);
  vec2 seaOff = uSea.x * (sea * 2.0 * (SEA_AMP + stirAmp) + chop * 2.0 * stirAmp * 0.6);
  vec2 cs = c + seaOff;                        // the field
  vec2 cL = c + seaOff * 0.3 * uEnergy;        // the plate

  // every dot has its own slow phase (it breathes) and wanders between random brightnesses at its own pace
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float tw = 0.5 + 0.5 * sin(uTime * (0.45 + 1.1 * h) + h * 60.0);
  float fr = uTime * (0.5 + 1.7 * fract(h * 91.7 + 0.37)) + h * 97.0;
  float fk = fract(fr);
  fk = fk * fk * (3.0 - 2.0 * fk);
  float flick = mix(hash3(vec3(cell, floor(fr))), hash3(vec3(cell, floor(fr) + 1.0)), fk);

  vec2 wv = waveAt(pDev);

  // ---- the plate: a ray from the camera through this cell, in the plate's own frame
  vec2 pp = (cL - lc) / min(uCells.x, uCells.y);
  vec3 O = uMt * vec3(0.0, 0.0, uP.y);
  vec3 D = uMt * normalize(vec3(pp, -uP.x));
  float hz = uP.z;
  // the face turned to the camera, met unconditionally (so the texture's derivatives are continuous and pick the right mip)
  float zf = O.z >= 0.0 ? hz : -hz;
  float tF = (zf - O.z) / (D.z + (D.z >= 0.0 ? 1e-6 : -1e-6));
  vec3 PF = O + tF * D;
  vec3 texel = texture2D(uTex, 0.5 + 0.5 * PF.xy / uHalf).rgb;

  float kind = 0.0;      // 0 nothing, 1 the face, 2 a wall (the rim, the hole's, a card's edge)
  vec3 nl = vec3(0.0);   // the wall's normal, in the plate's frame
  float best = 1e9;
  if (uPlate.w < 0.5) {
    float r0 = uPlate.z;
    float r2 = dot(PF.xy, PF.xy);
    if (tF > 0.0 && r2 <= 1.0 && r2 >= r0 * r0) { best = tF; kind = 1.0; }
    float a = dot(D.xy, D.xy);
    if (a > 1e-8) {
      float b = dot(O.xy, D.xy);
      float dsc = b * b - a * (dot(O.xy, O.xy) - 1.0);
      if (dsc > 0.0) {          // the rim: where the ray enters the cylinder
        float t = (-b - sqrt(dsc)) / a;
        vec3 P = O + t * D;
        if (t > 0.0 && t < best && abs(P.z) <= hz) { best = t; kind = 2.0; nl = vec3(P.xy, 0.0); }
      }
      if (r0 > 0.0) {
        float d1 = b * b - a * (dot(O.xy, O.xy) - r0 * r0);
        if (d1 > 0.0) {         // the wall of the hole, seen across it
          float t = (-b + sqrt(d1)) / a;
          vec3 P = O + t * D;
          if (t > 0.0 && t < best && abs(P.z) <= hz) { best = t; kind = 2.0; nl = -vec3(P.xy, 0.0); }
        }
      }
    }
  } else {
    vec3 Ds = D + vec3(1e-6);
    vec3 inv = 1.0 / Ds;
    vec3 bh = vec3(uPlate.x, uPlate.y, hz);
    vec3 ta = (-bh - O) * inv;
    vec3 tb = (bh - O) * inv;
    vec3 tn = min(ta, tb);
    vec3 tf = max(ta, tb);
    float tNear = max(tn.x, max(tn.y, tn.z));
    float tFar = min(tf.x, min(tf.y, tf.z));
    if (tNear < tFar && tNear > 0.0) {
      best = tNear;
      if (tNear == tn.z) kind = 1.0;
      else {
        kind = 2.0;
        nl = tNear == tn.x ? vec3(-sign(Ds.x), 0.0, 0.0) : vec3(0.0, -sign(Ds.y), 0.0);
      }
    }
  }

  // what the ray found, as a colour: the face is its texture (a little darker the more it turns away, and the far side a
  // little darker still); a wall catches a light from the upper left
  vec3 src = vec3(0.0);
  if (kind > 1.5) {
    vec3 nw = normalize(uM * normalize(nl));
    src = vec3(0.4 + 0.55 * max(dot(nw, normalize(vec3(-0.45, 0.65, 0.6))), 0.0));
  } else if (kind > 0.5) {
    src = texel * (1.0 - uP.w * (1.0 - abs(D.z))) * (O.z >= 0.0 ? 1.0 : 0.82);
  }

  // ---- the picture: its luminance is the tone (after the levels); where there is any, the plate's material replaces the field's
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

  // ---- the field: the hero's ambient dots, free blue noise, dim and cool; a passing wave thins it and cancels its energy
  vec2 pc = (cs - lc) / uCells.y;
  float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
  float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;
  float rip = vnoise(vec3(cs * SEA_RIPPLE, uTime * 0.12));
  float ripple = mix(1.0, 0.35 + 1.3 * rip, clamp(0.6 + 0.6 * uEnergy, 0.0, 1.0));
  float D0 = densityAt(cs);
  float lumC = (0.018 + 0.05 * D0) * (0.45 + nz) * (1.0 + 0.6 * wave) * ripple * (1.0 - WREV_THIN * wv.x) * (1.0 - WNULL * wv.y) * uB.y
    + push.z * 0.3 * (0.6 + 0.4 * tw) * uB.y;
  float toneC = (0.48 + 0.12 * D0 + 0.3 * push.z) * (1.0 - TWINKLE * tw) * (1.0 - FLICK_C * (1.0 - flick));

  // ---- the plate's dots: density follows the tone; bright areas sit on the checkerboard lattice (so dense dots never fuse)
  float lumL = (uA.x + 0.3 * push.z) * t * (1.0 - WNULL * wv.y);
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

const texture = (unit, min, mag, wrap) => {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
};
// unit 0: the plate's picture (mipmapped: it is seen small and at a slant) · 1: blue noise · 3: the field (render target), as in the hero
const plateTex = texture(0, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE);
const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
texture(1, gl.NEAREST, gl.NEAREST, gl.REPEAT);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
const fieldTex = texture(3, gl.NEAREST, gl.NEAREST, gl.CLAMP_TO_EDGE);
const fbo = gl.createFramebuffer();

const locs = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
const UF = locs(field, ["uCells", "uCell", "uDev", "uTime", "uIntro", "uA", "uB", "uP", "uPlate", "uHalf", "uM", "uMt", "uW[0]", "uSea", "uEnergy", "uBlue", "uTex"]);
const UC = locs(compose, ["uField", "uCells", "uCell"]);
gl.useProgram(field);
gl.uniform1i(UF.uTex, 0);
gl.uniform1i(UF.uBlue, 1);
gl.useProgram(compose);
gl.uniform1i(UC.uField, 3);

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
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, fieldTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
new ResizeObserver(resize).observe(canvas);
resize();

// ------------------------------------------------------------------ the model's pose
// Quaternions [x, y, z, w] and 3×3 matrices (row-major arrays of 9).
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  return a.map((v) => v / l);
};
const qaxis = (x, y, z, ang) => {
  const l = Math.hypot(x, y, z) || 1;
  const s = Math.sin(ang / 2) / l;
  return [x * s, y * s, z * s, Math.cos(ang / 2)];
};
function qslerp(a, b, t) {
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
const qmat = ([x, y, z, w]) => [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
const mmul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
const toGL = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]); // R, column-major
const toGLT = (m) => new Float32Array(m); // R's transpose, column-major, is R row-major

const homeQ = () => qnorm(qmul(qaxis(1, 0, 0, (P.rx * Math.PI) / 180), qaxis(0, 1, 0, (P.ry * Math.PI) / 180)));
const view = {
  q: homeQ(), // the pose shown…
  qt: homeQ(), // …follows this one, which the pointer moves
  w: [0, 0, 0], // angular velocity (rad/s, world axes): what a released turn keeps doing
  lz: 0, // log dolly shown…
  lzt: 0, // …and wanted
  drag: false,
};
let spinAngle = 0; // rad, clockwise: the plate's turn about its own axis

// ------------------------------------------------------------------ sources
// A source is { el, w, h } (an image or a video, drawn on the plate's texture) or { draw(ctx, t, T, T) } (a sketch that draws
// on the texture itself, white on black, T px square). `dynamic` ones are redrawn and re-uploaded every frame.
let source = null;
let plate = { disc: true, ax: 1, ay: 1, hole: CD_HOLE, half: [CD_HALF, CD_HALF] };
let texDirty = true;
let clock = 0; // s: the lab's own time (spin, the build, the dots, the waves); stops while paused
let buildT0 = 0;
let paused = false;

// the texture: a 2D canvas, a power of two (so it can be mipmapped)
const T = 2 ** clamp(Math.round(Math.log2(num("tex", 1024))), 8, 12);
const tex = document.createElement("canvas");
tex.width = tex.height = T;
const tctx = tex.getContext("2d", { alpha: false });

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
  // (onload, not decode(): decode() waits for a paint and never settles in a tab that is in the background)
  await new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = () => no(new Error(`could not load image ${name}`));
  });
  const gif = GIF_RE.test(name);
  if (gif) park(img);
  return { el: img, w: img.naturalWidth, h: img.naturalHeight, name, dynamic: gif };
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
  return { el: v, get w() { return v.videoWidth; }, get h() { return v.videoHeight; }, name, dynamic: true };
}

// The plate: the CD is a disc with a hole (and its sprite's disc fills 92 % of the picture); anything else is a card of the
// picture's own proportions (the longer half side is 1, as the disc's radius is). ?shape=disc|card and ?hole= override.
function plateFor(s) {
  const cd = s.name === DEFAULT_SRC;
  const shape = q.get("shape") === "disc" || q.get("shape") === "card" ? q.get("shape") : cd ? "disc" : "card";
  if (shape === "disc") {
    const half = cd ? CD_HALF : 1;
    return { disc: true, ax: 1, ay: 1, hole: q.has("hole") ? num("hole", 0) : cd ? CD_HOLE : 0, half: [half, half] };
  }
  const asp = s.draw ? 1 : s.w / s.h || 1;
  const ax = asp >= 1 ? 1 : asp;
  const ay = asp >= 1 ? 1 / asp : 1;
  return { disc: false, ax, ay, hole: 0, half: [ax, ay] };
}

function setSource(next) {
  if (source?.el instanceof HTMLElement) source.el.remove();
  if (source?.el instanceof HTMLVideoElement) source.el.pause();
  source = next;
  plate = plateFor(next);
  texDirty = true;
  buildT0 = clock;
  if (!q.has("spin")) P.spin = next.name === DEFAULT_SRC ? DEFAULT_SPIN : 0;
}

// `what` is a URL, a File (dropped or pasted), or "sketch:<name>"
async function load(what) {
  try {
    if (typeof what === "string" && what.startsWith("sketch:")) {
      const fn = SKETCHES[what.slice(7)];
      if (!fn) throw new Error(`no sketch called ${what.slice(7)} (have: ${Object.keys(SKETCHES).join(", ")})`);
      return setSource({ draw: fn, name: what, dynamic: true });
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
const sketch = (fn) => setSource({ draw: fn, name: "sketch", dynamic: true });

function uploadTexture() {
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.fillStyle = "#000";
  tctx.fillRect(0, 0, T, T);
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  if (source.draw) {
    tctx.save();
    source.draw(tctx, clock, T, T);
    tctx.restore();
  } else if (source.w && source.h) {
    tctx.drawImage(source.el, 0, 0, T, T); // (stretched to the square: the plate's own proportions put it right again)
  } else return; // (a video that has not got its first frame yet)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, plateTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  texDirty = false;
}

// ------------------------------------------------------------------ time: the model, the waves
let waves = []; // { x, y (CSS px on the canvas), t0 (the lab's clock), k }
let energy = 0; // 0 … 1: the sea's swell, stirred by a wave and settling over AFTERGLOW
let stir = [0, 0]; // CSS px: where it was stirred

// two pulses from (x, y); the second leaves a moment after the first (its t0 is in the future until then: the shader skips it)
function spawnWave(x, y) {
  for (let k = 0; k < WAVE_PULSES; k++) waves.push({ x, y, t0: clock + k * WAVE_PULSE_GAP, k: 1 - WAVE_PULSE_DECAY * k });
  energy = Math.max(energy, 0.85);
  stir = [x, y];
  while (waves.length > MAX_WAVES) waves.shift();
}

function advance(dt) {
  if (!paused) {
    clock += dt;
    spinAngle += ((P.spin * Math.PI) / 180) * dt;
    energy = Math.min(1, energy * Math.exp(-dt / AFTERGLOW));
    waves = waves.filter((w) => clock - w.t0 < WAVE_LIFE);
  }
  // a released turn keeps going and slows down; the shown pose follows the wanted one, eased
  if (!view.drag) {
    const sp = Math.hypot(...view.w);
    if (sp > 0.02) {
      view.qt = qnorm(qmul(qaxis(view.w[0], view.w[1], view.w[2], sp * dt), view.qt));
      const k = Math.exp(-dt * FRICTION);
      view.w = view.w.map((v) => v * k);
    } else view.w = [0, 0, 0];
  }
  view.q = qnorm(qslerp(view.q, view.qt, 1 - Math.exp(-dt * (view.drag ? FOLLOW_DRAG : FOLLOW_COAST))));
  view.lz += (1 - Math.exp(-dt * ZOOM_FOLLOW)) * (view.lzt - view.lz);
}

// ------------------------------------------------------------------ the frame
// the camera's distance at home: the plate (a disc's diameter, a card's longer side) takes P.size of the screen
function homeDist() {
  const W = canvas.clientWidth || innerWidth;
  const H = canvas.clientHeight || innerHeight;
  const m = Math.min(W, H);
  const a = plate.ax / W;
  const b = plate.ay / H;
  return P.fit === "cover" ? 2 * FOCAL * m * Math.min(a, b) : (2 * FOCAL * m * Math.max(a, b)) / P.size;
}

const waveData = new Float32Array(MAX_WAVES * 4);
function draw() {
  if (source && (texDirty || source.dynamic)) uploadTexture();

  // waves → uniforms (device px, y up)
  const cssH = canvas.clientHeight || innerHeight;
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = waves[i];
    const age = w ? clock - w.t0 : -1;
    waveData.set(w ? [w.x * dpr, (cssH - w.y) * dpr, age, (1 - clamp01(age / WAVE_LIFE)) * clamp01(age / 0.2) * w.k] : [0, 0, -1, 0], i * 4);
  }
  const M = mmul(qmat(view.q), [Math.cos(spinAngle), Math.sin(spinAngle), 0, -Math.sin(spinAngle), Math.cos(spinAngle), 0, 0, 0, 1]); // (clockwise on screen = negative about +z)

  // pass 1: the field, one fragment per cell
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, cells[0], cells[1]);
  gl.useProgram(field);
  gl.uniform2f(UF.uCells, cells[0], cells[1]);
  gl.uniform1f(UF.uCell, CELL);
  gl.uniform2f(UF.uDev, dev[0], dev[1]);
  gl.uniform1f(UF.uTime, clock);
  gl.uniform1f(UF.uIntro, P.build > 0 ? buildProgress((clock - buildT0) / P.build) : 1);
  gl.uniform4f(UF.uA, P.dens, P.gamma, P.black, P.white);
  gl.uniform4f(UF.uB, P.lattice, P.field, P.color, P.flicker);
  gl.uniform4f(UF.uP, FOCAL, homeDist() * Math.exp(-view.lz), P.thick / 2, P.shade);
  gl.uniform4f(UF.uPlate, plate.ax, plate.ay, plate.hole, plate.disc ? 0 : 1);
  gl.uniform2f(UF.uHalf, plate.half[0], plate.half[1]);
  gl.uniformMatrix3fv(UF.uM, false, toGL(M));
  gl.uniformMatrix3fv(UF.uMt, false, toGLT(M));
  gl.uniform4fv(UF["uW[0]"], waveData);
  gl.uniform3f(UF.uSea, 1, stir[0] * dpr, (cssH - stir[1]) * dpr);
  gl.uniform1f(UF.uEnergy, energy);
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
  advance(Math.min(0.05, (now - last) / 1000));
  last = now;
  draw();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ input
// One finger or the mouse: a press that moves turns the model (it glides on when let go); a press that does not move is a tap and
// sends the wave. Two fingers pinch (dolly). The wheel dollies too (a trackpad's pinch comes as ctrl+wheel).
const ptrs = new Map(); // pointers down: id → { x, y }
let gest = null; // the one-pointer gesture: { id, x0, y0, t0, x, y, tl, moved, touch }
let pinch = 0;
const fingerDist = () => {
  const [a, b] = [...ptrs.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
};
// turn the wanted pose by (dx, dy) CSS px of drag (about the world's y and x axes: the near side follows the pointer)
function turn(dx, dy) {
  const k = ROT_PER_SIDE / Math.min(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  view.qt = qnorm(qmul(qmul(qaxis(0, 1, 0, dx * k), qaxis(1, 0, 0, dy * k)), view.qt));
  return [dy * k, dx * k]; // (the rotation, about x and y)
}
const endGesture = () => {
  view.drag = false;
  canvas.classList.remove("drag");
  gest = null;
};

canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId); // (the move and the release keep coming even outside the window)
  } catch {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    const now = performance.now();
    gest = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now, x: e.clientX, y: e.clientY, tl: now, moved: false, touch: e.pointerType === "touch" };
    view.w = [0, 0, 0]; // a touch stops a glide
  } else {
    endGesture();
    pinch = fingerDist();
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (ptrs.size >= 2) {
    const d = fingerDist();
    view.lzt = clamp(view.lzt + Math.log(d / pinch), LZ_MIN, LZ_MAX);
    pinch = d;
    return;
  }
  if (!gest || gest.id !== e.pointerId) return;
  if (!gest.moved) {
    if (Math.hypot(e.clientX - gest.x0, e.clientY - gest.y0) < (gest.touch ? TOUCH_SLOP : MOUSE_SLOP)) return;
    gest.moved = true;
    view.drag = true;
    canvas.classList.add("drag");
  }
  const now = performance.now();
  const dt = Math.max(0.004, (now - gest.tl) / 1000);
  const [rx, ry] = turn(e.clientX - gest.x, e.clientY - gest.y);
  // the release velocity: a running average over the last ~50 ms of drag
  const a = 1 - Math.exp(-dt / 0.05);
  view.w = [view.w[0] + (rx / dt - view.w[0]) * a, view.w[1] + (ry / dt - view.w[1]) * a, 0];
  const sp = Math.hypot(...view.w);
  if (sp > MAX_SPIN_RATE) view.w = view.w.map((v) => (v * MAX_SPIN_RATE) / sp);
  gest.x = e.clientX;
  gest.y = e.clientY;
  gest.tl = now;
});
function release(e, cancelled) {
  const wasGesture = gest && gest.id === e.pointerId;
  ptrs.delete(e.pointerId);
  if (wasGesture) {
    const now = performance.now();
    const g = gest;
    endGesture();
    if (!g.moved) {
      view.w = [0, 0, 0];
      if (!cancelled && now - g.t0 < TAP_MS) {
        const r = canvas.getBoundingClientRect();
        spawnWave(e.clientX - r.left, e.clientY - r.top);
      }
    } else if (now - g.tl > 90) view.w = [0, 0, 0]; // (held still before letting go: no glide)
  }
  if (ptrs.size < 2) pinch = 0;
}
canvas.addEventListener("pointerup", (e) => release(e, false));
canvas.addEventListener("pointercancel", (e) => release(e, true));
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    view.lzt = clamp(view.lzt + (e.ctrlKey ? -px * ZOOM_WHEEL_PINCH : px * ZOOM_WHEEL), LZ_MIN, LZ_MAX);
  },
  { passive: false }
);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

function home() {
  view.qt = homeQ();
  view.w = [0, 0, 0];
  view.lzt = 0;
}
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
const STEP = 0.26; // rad per arrow key press
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const turnKey = (ax, ay, az, a) => (e.preventDefault(), (view.qt = qnorm(qmul(qaxis(ax, ay, az, a), view.qt))));
  if (e.code === "Space") {
    e.preventDefault();
    pause();
  } else if (e.key === "b") rebuild();
  else if (e.key === "r" || e.key === "0") home();
  else if (e.key === "ArrowLeft") turnKey(0, 1, 0, -STEP);
  else if (e.key === "ArrowRight") turnKey(0, 1, 0, STEP);
  else if (e.key === "ArrowUp") turnKey(1, 0, 0, -STEP);
  else if (e.key === "ArrowDown") turnKey(1, 0, 0, STEP);
  else if (e.key === "+" || e.key === "=") view.lzt = clamp(view.lzt + 0.2, LZ_MIN, LZ_MAX);
  else if (e.key === "-" || e.key === "_") view.lzt = clamp(view.lzt - 0.2, LZ_MIN, LZ_MAX);
});

// for tuning in the console and for checks (step(ms): advance the lab's clock and draw, in a preview that throttles frames)
window.__lab = {
  P,
  view,
  load,
  sketch,
  SKETCHES,
  pause,
  rebuild,
  home,
  resize,
  draw,
  wave: (x = (canvas.clientWidth || innerWidth) / 2, y = (canvas.clientHeight || innerHeight) / 2) => spawnWave(x, y),
  turn, // turn(dx, dy): as a drag of that many CSS px
  pose: (rx = 0, ry = 0) => { // set the pose at once (degrees: tilt back, turn sideways)
    view.qt = qnorm(qmul(qaxis(1, 0, 0, (rx * Math.PI) / 180), qaxis(0, 1, 0, (ry * Math.PI) / 180)));
    view.q = view.qt.slice();
    view.w = [0, 0, 0];
  },
  step: (ms = 16) => {
    const n = Math.max(1, Math.ceil(ms / 16));
    for (let i = 0; i < n; i++) advance(ms / 1000 / n);
    draw();
  },
  shot: () => (draw(), canvas.toDataURL("image/png")),
  info: () => ({ cell: CELL, cells: [...cells], dev: [...dev], dpr, clock, paused, source: source?.name ?? null, plate, waves: waves.length, energy, lz: view.lz, spin: P.spin }),
};

load(P.src).then(() => requestAnimationFrame(frame));
