// swarm/layers.js — what the dots are told to become. Pure functions, no DOM, no GL: a layer is a list of BODY points
// (x, y, z, w) in the layer's own space, w = element id + tone (tone in [0, 1)), sorted so that two layers pair up by place.
//
// Every layer has the same number of points (the dots are the same dots: nothing is created or destroyed, they are told to go
// somewhere else, as in a drone show). The last N − BODY points are the dust, the field: the same dots in every layer.
//
// Every point is one CELL of the screen's grid, as on the home. The flat layers are made by the home's own rule, cell by cell:
// tone × density against a blue-noise threshold, on the checkerboard lattice, so a point is exactly where the home would put
// a dot. The 3D layers are even, thin and regular (lines a cell or two thick, skins at a fixed spacing, light as a threshold
// on the same noise): no gaussian blur, no sand. A point with tone 0 is a spare: it is not drawn in this layer.
//
//   home     the wordmark, from the home's own SVG                                     (the reference)
//   ui       a panel of the page's real elements: crisp text and lines, a dithered fill
//   picture  a picture: tone is density, relief from tone
//   cube     a glass cube: bright edges and corners, a faint skin, a faint inside
//   sphere   a skin with bright veins and a few pools
//   column   a lit Ionic column: the light is the threshold
export const W = 384; // the state texture is W × H, one texel per dot
export const H = 256;
export const N = W * H;
export const BODY = 320 * 256; // the dots that make shapes; the rest are the field
export const LAYERS = ["home", "ui", "picture", "cube", "sphere", "column"];
export const FLAT = new Set(["home", "ui", "picture"]); // layers that lie in the screen's plane
export const CAMERA_D = 3.2; // the camera's distance: at z = 0 the screen's height is 2 world units
export const DENS_L = 0.72; // the home's: share of lattice sites lit inside a letter (hero.js)

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

/**
 * The context a layer is built for: the screen's grid. cell is in device px; view is the canvas in device px; bn is the 64 × 64
 * blue-noise threshold map (raster.js blueNoise(), bytes 0…255). cellWorld is a cell in world units.
 */
export function gridContext({ viewW, viewH, cell, bn }) {
  return { viewW, viewH, cell, bn, cols: Math.ceil(viewW / cell), rows: Math.ceil(viewH / cell), aspect: viewW / viewH, cellWorld: (2 * cell) / viewH };
}
const threshold = (bn, i, j) => bn[((j & 63) << 6) | (i & 63)] / 255;
/** The centre of cell (cx, cy), cy counted from the bottom, in world units at z = 0. */
export function cellCentre(ctx, cx, cy) {
  return [(((cx + 0.5) * ctx.cell) / ctx.viewW * 2 - 1) * ctx.aspect, ((cy + 0.5) * ctx.cell) / ctx.viewH * 2 - 1];
}
/** Where a point must be so that the camera, frontal, projects it to world (x, y) at z = 0: perspective undone. */
const preProject = (x, y, z) => [(x * (CAMERA_D - z)) / CAMERA_D, (y * (CAMERA_D - z)) / CAMERA_D, z];

// ---- collecting points, and making exactly BODY of them
function collector() {
  const hot = []; // tone ≥ 0.95: edges, solid text, corners: kept first
  const rest = [];
  return {
    add(x, y, z, id, tone) {
      (tone >= 0.95 ? hot : rest).push(x, y, z, pack(id, tone));
    },
    get count() {
      return (hot.length + rest.length) / 4;
    },
    hot,
    rest,
  };
}
/** Exactly BODY points: too many, the dim ones thin out at random; too few, the spares copy a point (tone 0: not drawn here). */
function finish(c, r) {
  const out = new Float32Array(BODY * 4);
  let n = 0;
  const put = (arr, i) => {
    out.set(arr.slice(i * 4, i * 4 + 4), n * 4);
    n++;
  };
  const hotN = Math.min(c.hot.length / 4, BODY);
  for (let i = 0; i < hotN; i++) put(c.hot, i);
  const room = BODY - n, restN = c.rest.length / 4;
  if (restN <= room) for (let i = 0; i < restN; i++) put(c.rest, i);
  else {
    const keep = room / restN; // a thinning that keeps the rest even: every point has the same chance
    for (let i = 0; i < restN && n < BODY; i++) if (r() < keep) put(c.rest, i);
    for (let i = 0; n < BODY && i < restN; i++) if (!(i & 1)) put(c.rest, i); // (rounding: top up)
  }
  const have = n;
  if (have === 0) out.set([0, 0, 0, pack(0, 0)], 0), (n = 1);
  const src = Math.max(1, n);
  for (; n < BODY; ) {
    const j = ((r() * src) | 0) * 4;
    out.set([out[j], out[j + 1], out[j + 2], pack(unpack(out[j + 3]).id, 0)], n * 4);
    n++;
  }
  return sortByPlace(out, BODY);
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

// ---- the field, and the scatter the dots start from
/**
 * How many of the home's field cells are lit at a point of the screen, relative to the peak (hero.js: the share of lit cells is
 * lumC = 0.018 + 0.05 × densityAt, and densityAt is a floor of 0.06 everywhere, a swell round the middle, a little less in the top
 * and bottom rows). So the noise reaches the edges: there it is about a third of the middle's. x in [−aspect, aspect], y in
 * [−1, 1], the screen's own coordinates.
 */
export function fieldDensity(x, y, aspect = 1.6) {
  const ex = x / aspect, ey = y * 0.82; // (the home squeezes the swell a little in y)
  const yv = (y + 1) / 2, t = Math.min(1, Math.max(0, Math.min(yv, 1 - yv) / 0.15));
  const calm = t * t * (3 - 2 * t);
  const D = (0.06 + 0.94 * Math.exp(-3 * (ex * ex + ey * ey))) * (0.35 + 0.65 * calm);
  return (0.018 + 0.05 * D) / 0.068;
}
/**
 * The field: faint dots, free (no lattice), laid over the WHOLE screen with the home's own profile: noise at the edges, more in the
 * middle (rejection-sampled from fieldDensity). It lies on the screen, in no depth: the camera does not turn it, and it is the same
 * in every layer. swarm.js draws only a share of it (density.js dustKeep).
 */
export function dust(aspect = 1.6, seed = 7) {
  const r = rng(seed);
  const a = new Float32Array((N - BODY) * 4);
  for (let i = 0; i < N - BODY; i++) {
    let x, y;
    do { x = (r() * 2 - 1) * aspect; y = r() * 2 - 1; } while (r() > fieldDensity(x, y, aspect));
    a.set([x, y, 0, pack(0, 0.4 + 0.5 * r())], i * 4);
  }
  return a;
}
export function scatter(seed = 3) {
  const r = rng(seed);
  const c = collector();
  for (let i = 0; i < BODY; i++) c.add((r() * 2 - 1) * 2.8, (r() * 2 - 1) * 1.9, (r() * 2 - 1) * 1.4, 0, 0.5 + 0.4 * r());
  return finish(c, r);
}
/** body + field → the N points a layer is made of. */
export function assemble(body, dustArr) {
  const a = new Float32Array(N * 4);
  a.set(body, 0);
  a.set(dustArr, BODY * 4);
  return a;
}

// ---- flat layers: the home's rule, cell by cell
/**
 * sample(cx, cy) → tone 0…1 for cell (cx, cy), cy from the bottom. A cell with tone ≥ opts.solid is lit whatever its place (crisp
 * text and lines). Below that it is dithered as the home does: only lattice sites (cx + cy even) if opts.lattice, lit when
 * tone × opts.dens passes the blue-noise threshold. opts: { dens, lattice, solid, depth (relief from tone), idAt(cx, cy) }.
 */
export function ditherBody(sample, ctx, opts = {}, seed = 11) {
  const o = { dens: DENS_L, lattice: true, solid: 0.7, depth: 0, idAt: null, ...opts };
  const r = rng(seed), c = collector();
  for (let cy = 0; cy < ctx.rows; cy++) {
    for (let cx = 0; cx < ctx.cols; cx++) {
      const t = sample(cx, cy);
      if (!(t > 0.02)) continue;
      let tone;
      if (t >= o.solid) tone = 1;
      else {
        if (o.lattice && ((cx + cy) & 1)) continue;
        const lum = o.dens * t, th = threshold(ctx.bn, cx, cy);
        if (!(lum > th + 0.3 * (0.12 * lum + 0.004))) continue; // the home's: on = clamp((lum − th) / (0.12 lum + 0.004)), cut below 0.3
        tone = 0.86 + 0.1 * r();
      }
      const [x, y] = cellCentre(ctx, cx, cy);
      const z = o.depth * (t - 0.5);
      const p = preProject(x, y, z);
      c.add(p[0], p[1], p[2], o.idAt ? o.idAt(cx, cy) : 0, tone);
    }
  }
  return finish(c, r);
}

// ---- 3D layers: even, thin, regular. sp is a cell in world units (kept off the very small, so counts stay in budget)
const spacing = (ctx) => Math.max(ctx.cellWorld, 0.0025);

export function cubeBody(ctx, seed = 21) {
  const r = rng(seed), c = collector(), sp = spacing(ctx), s = 0.44;
  const corner = (i) => [i & 1 ? s : -s, i & 2 ? s : -s, i & 4 ? s : -s];
  // edges: a line two cells thick, tone 1 (bright)
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    const d = a ^ b;
    if (d & (d - 1)) continue; // not an edge
    const ax = d === 1 ? 0 : d === 2 ? 1 : 2, o1 = (ax + 1) % 3, o2 = (ax + 2) % 3, A = corner(a), n = Math.floor((2 * s) / sp);
    for (let k = 0; k <= n; k++) for (let u = 0; u < 2; u++) for (let v = 0; v < 2; v++) {
      const p = A.slice();
      p[ax] = -s + (k / n) * 2 * s;
      p[o1] += (u - 0.5) * sp;
      p[o2] += (v - 0.5) * sp;
      c.add(p[0], p[1], p[2], 0, 1);
    }
  }
  // corners: a small cube of cells, bright
  for (let i = 0; i < 8; i++) {
    const A = corner(i);
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) if (x * x + y * y + z * z <= 5) c.add(A[0] + x * sp, A[1] + y * sp, A[2] + z * sp, 0, 1);
  }
  // faces: a skin, lit where a faint tone passes the blue-noise threshold on the face's own grid
  const g = 1.6 * sp, m = Math.floor((2 * s) / g);
  for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) for (let i = 0; i <= m; i++) for (let j = 0; j <= m; j++) {
    if (!(0.2 > threshold(ctx.bn, i + 17 * ax + 31 * (sg + 1), j + 11 * ax))) continue;
    const p = [0, 0, 0];
    p[ax] = sg * s;
    p[(ax + 1) % 3] = -s + (i / m) * 2 * s;
    p[(ax + 2) % 3] = -s + (j / m) * 2 * s;
    c.add(p[0], p[1], p[2], 0, 0.86 + 0.1 * r());
  }
  // inside: a few, evenly (a low-discrepancy sequence, not noise)
  for (let i = 1; i <= 5000; i++) c.add((((i * 0.7548776662) % 1) * 2 - 1) * s, (((i * 0.5698402909) % 1) * 2 - 1) * s, (((i * 0.6180339887) % 1) * 2 - 1) * s, 0, 0.8 + 0.1 * r());
  return finish(c, r);
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};

export function sphereBody(ctx, seed = 31) {
  const r = rng(seed), c = collector(), sp = spacing(ctx), R = 0.66;
  // skin: a Fibonacci lattice, even, a few per cent of the surface cells
  const n = Math.min(32000, Math.floor((4 * Math.PI * R * R * 0.05) / (sp * sp)));
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, rad = Math.sqrt(1 - y * y), th = ga * i;
    c.add(Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R, 0, 0.86 + 0.1 * r());
  }
  // veins: walks along great circles that wander, two cells wide, bright
  const unit = () => norm([r() - 0.5, r() - 0.5, r() - 0.5].map((x) => x + 1e-6));
  for (let v = 0; v < 8; v++) {
    let p = unit(), t = norm(cross(p, unit())), drift = 0;
    const a = sp / R, steps = Math.min(1400, Math.floor(7 / a));
    for (let j = 0; j < steps; j++) {
      const np = [0, 1, 2].map((k) => p[k] * Math.cos(a) + t[k] * Math.sin(a));
      const nt = [0, 1, 2].map((k) => -p[k] * Math.sin(a) + t[k] * Math.cos(a));
      drift = (drift + gauss(r) * 0.006) * 0.97;
      const side = cross(np, nt);
      p = np;
      t = norm([0, 1, 2].map((k) => nt[k] * Math.cos(drift) + side[k] * Math.sin(drift)));
      const sd = cross(p, t);
      c.add(p[0] * R, p[1] * R, p[2] * R, 0, 1);
      c.add(p[0] * R + sd[0] * sp, p[1] * R + sd[1] * sp, p[2] * R + sd[2] * sp, 0, 1);
    }
  }
  // pools: a disc of cells on the skin
  for (let q = 0; q < 5; q++) {
    const ctr = unit(), e1 = norm(cross(ctr, [0.3, 0.8, 0.5])), e2 = cross(ctr, e1), rad = 0.06, g = 1.2 * sp;
    for (let x = -rad; x <= rad; x += g) for (let y = -rad; y <= rad; y += g) {
      if (x * x + y * y > rad * rad) continue;
      const p = norm([0, 1, 2].map((k) => ctr[k] + (e1[k] * x + e2[k] * y) / R));
      c.add(p[0] * R, p[1] * R, p[2] * R, 0, 1);
    }
  }
  return finish(c, r);
}

export function columnBody(ctx, seed = 41) {
  const r = rng(seed), c = collector(), sp = spacing(ctx), g = 1.5 * sp, yShift = 0.15;
  const L = norm([-0.55, 0.35, 0.75]);
  const lit = (n) => Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  const bn = (i, j) => threshold(ctx.bn, i, j);
  // the light is the threshold: a surface cell is lit when its tone passes the blue noise, so the shading is a dither
  const surface = (i, j, tone, x, y, z) => {
    if (tone * 1.25 > bn(i, j)) c.add(x, y + yShift, z, 0, 0.86 + 0.1 * r());
  };
  // the shaft: tapered, fluted
  const nY = Math.floor(1.08 / g), nT = Math.floor((TAU * 0.17) / g);
  for (let j = 0; j <= nY; j++) for (let i = 0; i < nT; i++) {
    const y = -0.78 + (j / nY) * 1.08, th = (i / nT) * TAU, taper = 0.17 - (0.02 * (y + 0.78)) / 1.08;
    const flute = 0.5 + 0.5 * Math.cos(16 * th), rad = taper * (1 - 0.06 * (1 - flute)), slope = 0.55 * Math.sin(16 * th);
    const nrm = norm([Math.cos(th) - Math.sin(th) * slope, 0, Math.sin(th) + Math.cos(th) * slope]);
    surface(i, j, 0.04 + 0.96 * Math.pow(lit(nrm), 1.3) * (0.55 + 0.45 * flute), Math.cos(th) * rad, y, Math.sin(th) * rad);
  }
  // the echinus: a flaring ring under the slab
  const nE = Math.floor(0.12 / g), nET = Math.floor((TAU * 0.21) / g);
  for (let j = 0; j <= nE; j++) for (let i = 0; i < nET; i++) {
    const u = j / nE, th = (i / nET) * TAU, rad = 0.17 + 0.08 * u * u;
    surface(i + 40, j + 9, 0.12 + 0.88 * lit(norm([Math.cos(th), 0.3, Math.sin(th)])), Math.cos(th) * rad, 0.3 + 0.12 * u, Math.sin(th) * rad);
  }
  // the abacus: a thin slab, its top and four sides
  const nA = Math.floor(0.6 / g), nH = Math.max(1, Math.floor(0.08 / g));
  for (let i = 0; i <= nA; i++) {
    for (let j = 0; j <= nA; j++) surface(i + 7, j + 21, 0.12 + 0.88 * lit([0, 1, 0]), -0.3 + (i / nA) * 0.6, 0.5, -0.3 + (j / nA) * 0.6);
    for (let k = 0; k <= nH; k++) {
      const y = 0.42 + (k / nH) * 0.08, a = -0.3 + (i / nA) * 0.6;
      surface(i + 3, k + 5, 0.12 + 0.88 * lit([0, 0, 1]), a, y, 0.3);
      surface(i + 29, k + 5, 0.12 + 0.88 * lit([0, 0, -1]), a, y, -0.3);
      surface(i + 13, k + 5, 0.12 + 0.88 * lit([1, 0, 0]), 0.3, y, a);
      surface(i + 37, k + 5, 0.12 + 0.88 * lit([-1, 0, 0]), -0.3, y, a);
    }
  }
  // the volutes: a spiral two cells wide, on each side, front and back, bright
  for (const side of [-1, 1]) for (const z of [0.27, -0.27]) {
    const steps = Math.floor(0.33 / sp), phiMax = 2.6 * Math.PI;
    for (let k = 0; k <= steps; k++) {
      const phi = (k / steps) * phiMax, rad = 0.075 * Math.exp(-0.17 * phi), ang = side * phi + (side < 0 ? Math.PI : 0);
      for (let u = 0; u < 2; u++) c.add(side * 0.255 + Math.cos(ang) * rad + u * sp, 0.36 + yShift + Math.sin(ang) * rad, z, 0, 1);
    }
  }
  // the base: two rings, bright
  for (let ring = 0; ring < 2; ring++) {
    const rad = 0.2 + 0.03 * ring, n = Math.floor((TAU * rad) / sp);
    for (let k = 0; k < n; k++) {
      const th = (k / n) * TAU;
      c.add(Math.cos(th) * rad, -0.77 + 0.03 * ring + yShift, Math.sin(th) * rad, 0, 1);
    }
  }
  return finish(c, r);
}

// ---- how each 3D layer sits and moves in the world: a 3×3, column-major, yaw then pitch. Flat layers do not turn: they lie on
// the screen's grid, cell for cell. (The camera, which the drag turns, is separate.)
function yawPitch(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]); // Rx(pitch) · Ry(yaw)
}
export function rotation(name, t) {
  switch (name) {
    case "cube": return yawPitch(t * 0.3 + 0.6, 0.5 + 0.1 * Math.sin(t * 0.4));
    case "sphere": return yawPitch(t * 0.2, 0.28);
    case "column": return yawPitch(0.3 * Math.sin(t * 0.3), 0.04);
    default: return yawPitch(0, 0);
  }
}
