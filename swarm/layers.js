// swarm/layers.js — what the dots are told to become. Pure functions, no DOM, no GL: a layer is a list of BODY points
// (x, y, z, w) in the layer's own space, w = element id + tone (tone in [0, 1)), sorted so that two layers pair up by place.
//
// Every layer has the same number of points (the dots are the same dots: nothing is created or destroyed, they are told to go
// somewhere else, as in a drone show). The last N − BODY points are the dust, the same in every layer.
//
//   ui       a bitmap of the page's real elements (swarm.js draws it from the DOM) → text and buttons
//   cosmos   a picture: tone is density, relief from tone
//   cube     a glass cube: bright edges and corners, a faint skin, a faint inside
//   sphere   a skin with bright veins and a few pools
//   column   a lit Ionic column: tone from a light, density follows it
export const W = 384; // the state texture is W × H, one texel per dot
export const H = 256;
export const N = W * H;
export const BODY = 320 * 256; // the dots that make shapes; the rest are dust
export const LAYERS = ["ui", "cosmos", "cube", "sphere", "column"];

const TAU = Math.PI * 2;

/** mulberry32: a small seeded generator, so a layer is the same every time (and a test can say so). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r());
export const pack = (id, tone) => id + Math.min(0.999, Math.max(0, tone));
export const unpack = (w) => ({ id: Math.floor(w), tone: w - Math.floor(w) });

function makeOut(count) {
  const a = new Float32Array(count * 4);
  let n = 0;
  return {
    a,
    get n() {
      return n;
    },
    count,
    full: () => n >= count,
    push(x, y, z, id, tone) {
      if (n >= count) return;
      const i = n++ * 4;
      a[i] = x;
      a[i + 1] = y;
      a[i + 2] = z;
      a[i + 3] = pack(id, tone);
    },
  };
}

/** Fill what is left with a dim haze round the points already there: the grain round a shape, in the references. */
function haze(out, r, sigma, toneMul) {
  const have = out.n;
  while (!out.full()) {
    const j = ((r() * have) | 0) * 4;
    const w = out.a[j + 3];
    const { id, tone } = unpack(w);
    out.push(out.a[j] + gauss(r) * sigma, out.a[j + 1] + gauss(r) * sigma, out.a[j + 2] + gauss(r) * sigma, id, Math.max(0.06, tone * toneMul));
  }
}

// ---- pairing: sort by place so that dot i in one layer is near dot i in the next, in the same relative spot
function spread(v) {
  v &= 0x3ff;
  v = (v | (v << 16)) & 0x030000ff;
  v = (v | (v << 8)) & 0x0300f00f;
  v = (v | (v << 4)) & 0x030c30c3;
  v = (v | (v << 2)) & 0x09249249;
  return v;
}
export function mortonKeys(a, count) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
    const v = a[i * 4 + k];
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  const keys = new Uint32Array(count);
  const sc = [0, 1, 2].map((k) => 1023 / Math.max(hi[k] - lo[k], 0.2)); // a flat layer does not blow its thin axis up
  for (let i = 0; i < count; i++) {
    const q = [0, 1, 2].map((k) => Math.min(1023, Math.max(0, Math.round((a[i * 4 + k] - lo[k]) * sc[k]))));
    keys[i] = (spread(q[0]) | (spread(q[1]) << 1) | (spread(q[2]) << 2)) >>> 0;
  }
  return keys;
}
export function sortByPlace(a, count = a.length / 4) {
  const keys = mortonKeys(a, count);
  const order = Uint32Array.from({ length: count }, (_, i) => i).sort((p, q) => keys[p] - keys[q]);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) out.set(a.subarray(order[i] * 4, order[i] * 4 + 4), i * 4);
  return out;
}

// ---- the dust, and the scatter the dots start from
export function dust(seed = 7) {
  const r = rng(seed);
  const count = N - BODY;
  const out = makeOut(count);
  while (!out.full()) {
    const x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1;
    if (x * x + y * y + z * z > 1) continue;
    const rad = 0.5 + 1.6 * Math.cbrt(r());
    const len = Math.hypot(x, y, z) || 1;
    out.push((x / len) * rad * 1.5, (y / len) * rad, (z / len) * rad, 0, 0.08 + 0.2 * r() * r());
  }
  return out.a;
}
export function scatter(seed = 3) {
  const r = rng(seed);
  const out = makeOut(BODY);
  while (!out.full()) {
    const x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1;
    if (x * x + y * y + z * z > 1) continue;
    out.push(x * 2.6, y * 1.8, z * 2.2, 0, 0.1 + 0.12 * r());
  }
  return sortByPlace(out.a, BODY);
}

/** body + dust → the N points a layer is made of. */
export function assemble(body, dustArr) {
  const a = new Float32Array(N * 4);
  a.set(body, 0);
  a.set(dustArr, BODY * 4);
  return a;
}

// ---- layers made of a bitmap (the page's elements, a picture)
/**
 * bitmap: { data: RGBA bytes, width, height }. Points are drawn in proportion to tone^gamma (tone is density), jittered inside
 * their pixel. opts: worldH (the bitmap's height in world units), count (shape points; the rest is haze), gamma, thr, depth (relief
 * from tone), baseTone, haze: [sigma, toneMul], regions: [{ id, x, y, w, h }] (pixels) that give a point its element id.
 */
export function bitmapBody(bitmap, opts, seed = 11) {
  const { data, width: w, height: h } = bitmap;
  const o = { gamma: 1, thr: 0.04, depth: 0, baseTone: 0.8, haze: [0.012, 0.35], regions: [], ...opts };
  const r = rng(seed);
  const cdf = new Float64Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    const lum = ((0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255) * (data[i * 4 + 3] / 255);
    if (lum > o.thr) total += Math.pow(lum, o.gamma);
    cdf[i] = total;
  }
  const out = makeOut(BODY);
  const sc = o.worldH / h;
  if (total > 0) {
    for (let k = 0; k < o.count; k++) {
      const u = r() * total;
      let lo = 0, hi = w * h - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < u) lo = mid + 1; else hi = mid;
      }
      const px = lo % w, py = (lo / w) | 0;
      const lum = ((0.2126 * data[lo * 4] + 0.7152 * data[lo * 4 + 1] + 0.0722 * data[lo * 4 + 2]) / 255) * (data[lo * 4 + 3] / 255);
      let id = 0;
      for (const g of o.regions) if (px >= g.x && px < g.x + g.w && py >= g.y && py < g.y + g.h) { id = g.id; break; }
      out.push((px + r() - w / 2) * sc, -(py + r() - h / 2) * sc, o.depth * (lum - 0.5) + gauss(r) * 0.004, id, o.baseTone * (0.85 + 0.3 * r()));
    }
  }
  if (out.n === 0) out.push(0, 0, 0, 0, 0.5); // an empty bitmap still has one dot to spread the haze from
  haze(out, r, o.haze[0], o.haze[1]);
  return sortByPlace(out.a, BODY);
}

// ---- 3D layers
export function cubeBody(seed = 21) {
  const r = rng(seed), out = makeOut(BODY), s = 0.44;
  const corners = Array.from({ length: 8 }, (_, i) => [i & 1 ? s : -s, i & 2 ? s : -s, i & 4 ? s : -s]);
  const edges = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if (((a ^ b) & ((a ^ b) - 1)) === 0) edges.push([corners[a], corners[b]]);
  const share = (f) => Math.floor(BODY * f);
  const nEdge = share(0.46), nCorner = share(0.09), nFace = share(0.15);
  for (let i = 0; i < nEdge; i++) {
    const [p, q] = edges[(r() * edges.length) | 0], t = r();
    out.push(p[0] + (q[0] - p[0]) * t + gauss(r) * 0.011, p[1] + (q[1] - p[1]) * t + gauss(r) * 0.011, p[2] + (q[2] - p[2]) * t + gauss(r) * 0.011, 0, 0.72 + 0.25 * r());
  }
  for (let i = 0; i < nCorner; i++) {
    const c = corners[(r() * 8) | 0];
    out.push(c[0] + gauss(r) * 0.04, c[1] + gauss(r) * 0.04, c[2] + gauss(r) * 0.04, 0, 0.9 + 0.09 * r());
  }
  for (let i = 0; i < nFace; i++) {
    const ax = (r() * 3) | 0, sg = r() < 0.5 ? -s : s, p = [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];
    p[ax] = sg + gauss(r) * 0.008;
    out.push(p[0], p[1], p[2], 0, 0.3 + 0.2 * r());
  }
  while (!out.full()) out.push((r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s, 0, 0.12 + 0.14 * r());
  return sortByPlace(out.a, BODY);
}

function unit(r) {
  for (;;) {
    const x = gauss(r), y = gauss(r), z = gauss(r), l = Math.hypot(x, y, z);
    if (l > 1e-6) return [x / l, y / l, z / l];
  }
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function sphereBody(seed = 31) {
  const r = rng(seed), out = makeOut(BODY), R = 0.66;
  const nSkin = Math.floor(BODY * 0.5), nVein = Math.floor(BODY * 0.4), nPool = Math.floor(BODY * 0.1);
  for (let i = 0; i < nSkin; i++) {
    const u = unit(r), k = R * (1 + gauss(r) * 0.01);
    out.push(u[0] * k, u[1] * k, u[2] * k, 0, 0.28 + 0.2 * r());
  }
  const veins = 8, per = Math.floor(nVein / veins);
  for (let v = 0; v < veins; v++) {
    let p = unit(r), t = cross(p, unit(r));
    let tl = Math.hypot(...t) || 1;
    t = t.map((x) => x / tl);
    let drift = 0;
    for (let j = 0; j < per; j++) {
      const a = 0.0045; // a step along the great circle
      const np = [0, 1, 2].map((k) => p[k] * Math.cos(a) + t[k] * Math.sin(a));
      const nt = [0, 1, 2].map((k) => -p[k] * Math.sin(a) + t[k] * Math.cos(a));
      drift += gauss(r) * 0.006;
      drift *= 0.97;
      const c = cross(np, nt), b = drift;
      p = np;
      t = [0, 1, 2].map((k) => nt[k] * Math.cos(b) + c[k] * Math.sin(b));
      const k = R * (1 + gauss(r) * 0.004);
      out.push(p[0] * k + t[0] * gauss(r) * 0.009, p[1] * k + t[1] * gauss(r) * 0.009, p[2] * k + t[2] * gauss(r) * 0.009, 0, 0.9 + 0.09 * r());
    }
  }
  const pools = 5;
  for (let q = 0; q < pools; q++) {
    const c = unit(r);
    for (let j = 0; j < Math.floor(nPool / pools); j++) {
      const u = [c[0] + gauss(r) * 0.08, c[1] + gauss(r) * 0.08, c[2] + gauss(r) * 0.08], l = Math.hypot(...u) || 1;
      out.push((u[0] / l) * R, (u[1] / l) * R, (u[2] / l) * R, 0, 0.88 + 0.1 * r());
    }
  }
  haze(out, r, 0.006, 0.5);
  return sortByPlace(out.a, BODY);
}

export function columnBody(seed = 41) {
  const r = rng(seed), out = makeOut(BODY);
  const L = (() => { const v = [-0.55, 0.35, 0.75], l = Math.hypot(...v); return v.map((x) => x / l); })();
  const lit = (n) => Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  const yShift = 0.15; // so the column sits in the middle of the screen
  const share = (f) => Math.floor(BODY * f);
  const accept = (tone, push) => { if (r() < Math.pow(tone, 0.8)) push(tone); };
  // the shaft: tapered, fluted; density follows the light
  for (let n = 0, tries = 0; n < share(0.52) && tries < 4e6; tries++) {
    const th = r() * TAU, y = -0.78 + r() * 1.08, taper = 0.17 - (0.02 * (y + 0.78)) / 1.08;
    const flute = 0.5 + 0.5 * Math.cos(16 * th), rad = taper * (1 - 0.06 * (1 - flute));
    const slope = 0.55 * Math.sin(16 * th);
    let nrm = [Math.cos(th) - Math.sin(th) * slope, 0, Math.sin(th) + Math.cos(th) * slope];
    const l = Math.hypot(...nrm);
    nrm = nrm.map((x) => x / l);
    const tone = 0.04 + 0.96 * Math.pow(lit(nrm), 1.3) * (0.55 + 0.45 * flute);
    accept(tone, (t) => { out.push(Math.cos(th) * rad, y + yShift, Math.sin(th) * rad, 0, 0.3 + 0.6 * t); n++; });
  }
  // the echinus: a flaring ring under the slab
  for (let n = 0, tries = 0; n < share(0.08) && tries < 2e6; tries++) {
    const th = r() * TAU, u = r(), y = 0.3 + 0.12 * u, rad = 0.17 + 0.08 * u * u;
    const tone = 0.12 + 0.88 * lit([Math.cos(th), 0.3, Math.sin(th)].map((x, _, a) => x / Math.hypot(...a)));
    accept(tone, (t) => { out.push(Math.cos(th) * rad, y + yShift, Math.sin(th) * rad, 0, 0.3 + 0.6 * t); n++; });
  }
  // the abacus: a thin slab, its top and four sides
  for (let n = 0, tries = 0; n < share(0.12) && tries < 2e6; tries++) {
    const side = (r() * 5) | 0, a = (r() * 2 - 1) * 0.3, b = (r() * 2 - 1) * 0.3, y = 0.42 + r() * 0.08;
    let p, nrm;
    if (side === 0) { p = [a, 0.5, b]; nrm = [0, 1, 0]; }
    else if (side === 1) { p = [a, y, 0.3]; nrm = [0, 0, 1]; }
    else if (side === 2) { p = [a, y, -0.3]; nrm = [0, 0, -1]; }
    else if (side === 3) { p = [0.3, y, b]; nrm = [1, 0, 0]; }
    else { p = [-0.3, y, b]; nrm = [-1, 0, 0]; }
    const tone = 0.12 + 0.88 * lit(nrm);
    accept(tone, (t) => { out.push(p[0], p[1] + yShift, p[2], 0, 0.3 + 0.6 * t); n++; });
  }
  // the volutes: two spirals on each side of the capital, front and back
  const nVol = share(0.1);
  for (let i = 0; i < nVol; i++) {
    const phi = r() * 2.6 * Math.PI, rad = 0.075 * Math.exp(-0.17 * phi), side = r() < 0.5 ? -1 : 1, z = r() < 0.5 ? 0.27 : -0.27;
    const ang = side * phi + (side < 0 ? Math.PI : 0);
    out.push(side * 0.255 + Math.cos(ang) * rad + gauss(r) * 0.006, 0.36 + yShift + Math.sin(ang) * rad + gauss(r) * 0.006, z + gauss(r) * 0.012, 0, 0.6 + 0.3 * r());
  }
  // the base: two rings
  for (let i = 0, n = share(0.06); i < n; i++) {
    const th = r() * TAU, ring = r() < 0.5 ? 0 : 1, rad = 0.2 + 0.03 * ring;
    out.push(Math.cos(th) * rad, -0.77 + 0.03 * ring + yShift + gauss(r) * 0.005, Math.sin(th) * rad, 0, 0.3 + 0.4 * lit([Math.cos(th), 0.2, Math.sin(th)]));
  }
  haze(out, r, 0.02, 0.5);
  return sortByPlace(out.a, BODY);
}

// ---- how each layer sits and moves in the world: a 3×3, column-major, yaw then pitch
function yawPitch(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  // M = Rx(pitch) · Ry(yaw), written out; GLSL reads it column by column
  return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
}
export function rotation(name, t) {
  switch (name) {
    case "ui": return yawPitch(0, 0); // the interface does not turn: it is where the DOM says it is
    case "cosmos": return yawPitch(0.16 * Math.sin(t * 0.35), 0.05 * Math.sin(t * 0.27));
    case "cube": return yawPitch(t * 0.35 + 0.6, 0.5 + 0.12 * Math.sin(t * 0.4));
    case "sphere": return yawPitch(t * 0.22, 0.28);
    case "column": return yawPitch(0.4 * Math.sin(t * 0.3), 0.04);
    default: return yawPitch(0, 0);
  }
}
