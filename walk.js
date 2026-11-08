// cardozo.cc — the walk between two sheets of dots. Pure maths: no DOM, no GL (hero.js draws it; tools/test.sh tests it).
//
// When the page changes, the dots that are lit in the old sheet (the wordmark, a page) go out, walk to the cells that are lit in
// the new one along the shortest path (a straight line), a hop at a time, and light up with a flash where they land. Nothing is
// created or destroyed: a dot of one sheet is paired with a dot of the other (both sorted by place, so dot i is near dot i, the
// walks are short and read as flow) and the old dot becomes the new one. The home's own shader draws both sheets as it always
// does, so each looks exactly as it does on its own page; this module only says WHEN each cell goes out and lands, and which
// dots walk lit. Only a few do (WALKERS): the ones the eye can follow, each with a trail of the places it hopped from; the
// rest walk in the dark. Found out on /swarm (docs/PLANKTON.md §14): 80 000 dots walking dim read as a grey fog.

export const HOP_RATE = 18; // hops a second: each dot jumps a few cells and stands, on its own beat
export const WALKERS = 0.16; // the share of the dots that stay lit on the way
export const PAUSE_S = 0.12; // s: a dot goes out where it stands (it stutters, lit less and less often) before it sets off
export const TRAIL = 3; // the places a walker hopped from, drawn fading behind it
export const SPAN = 4; // s: the times are kept in 8 bits over this span
export const WAVE_S = 0.68; // s per screen height: the wave through the old sheet, from the middle outwards
export const JITTER_S = 0.5; // s: each dot's own moment on top of it
export const FLASH_S = 0.25; // s: how long a dot flashes after landing

/** How long a dot takes to walk `cells` cells: the farther the longer, never long. h2 is the dot's own 0…1. */
export const walkTime = (cells, h2) => Math.min(1.6, Math.max(0.45, cells / 110)) * (0.85 + 0.3 * h2);
/** How many hops that is. */
export const walkHops = (T, rate = HOP_RATE) => Math.max(1, Math.floor(T * rate));

/** The same two functions for the carriers' vertex shader (GLSL ES 1.00): one source of truth for the numbers. */
export const GLSL_WALK = `
uniform float uHop; // hops a second
float walkTime(float cells, float h2) { return clamp(cells / 110.0, 0.45, 1.6) * (0.85 + 0.3 * h2); }
float walkHops(float T) { return max(1.0, floor(T * uHop)); }`;

/** 0…1, a function of n alone (the same hash the shaders use, so a dot is the same dot everywhere). */
export const hash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The Morton (z-order) key of a cell inside a box: neighbours in the key are neighbours on the screen. */
export function morton(x, y) {
  const spread = (v) => {
    v &= 0xffff;
    v = (v | (v << 8)) & 0x00ff00ff;
    v = (v | (v << 4)) & 0x0f0f0f0f;
    v = (v | (v << 2)) & 0x33333333;
    v = (v | (v << 1)) & 0x55555555;
    return v;
  };
  return (spread(x) | (spread(y) << 1)) >>> 0;
}

/**
 * The cells (indices y × cols + x) in order of place: a Morton key over THEIR OWN bounding box, so a small sheet and a big one are
 * paired left with left and top with top, whatever their size. Returns a new Uint32Array.
 */
export function inPlaceOrder(cells, cols) {
  const n = cells.length;
  if (!n) return new Uint32Array(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = cells[i] % cols, y = (cells[i] / cols) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const sx = 65535 / Math.max(1, x1 - x0), sy = 65535 / Math.max(1, y1 - y0);
  const MULT = 2097152; // 2^21: key (32 bits) × 2^21 + index stays under 2^53, so the sort is on exact numbers, and fast
  if (n >= MULT) throw new Error("too many lit cells to pair");
  const packed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = cells[i] % cols, y = (cells[i] / cols) | 0;
    packed[i] = morton(Math.floor((x - x0) * sx), Math.floor((y - y0) * sy)) * MULT + i;
  }
  packed.sort();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = cells[packed[i] % MULT];
  return out;
}

/**
 * Pair the lit cells of the old sheet (a) with those of the new (b), on a screen of cols × rows cells, and say when everything
 * happens. a, b: arrays of cell indices.
 *
 * Returns:
 *   out   Uint8Array(cols × rows)  when the dot at this cell goes out, in SPAN/254 s steps (a cell the old sheet does not light
 *                                  has a time too: whatever the pointer pushed onto it goes out with the rest)
 *   arr   Uint8Array(cols × rows)  when a dot lands at this cell (the same, for the new sheet)
 *   stay  Uint8Array(cols × rows)  1 where a dot of the old sheet is also lit in the new one at the same cell: it does not move
 *   carriers { n, from, to, par }  the walkers that stay lit: from/to in cells (Float32Array 2n), par = (when it sets off, h2, h3, 0)
 *   ends  s                        when the last dot has landed
 */
export function pair(a, b, cols, rows, opts = {}) {
  const walkers = opts.walkers ?? WALKERS;
  const cells = cols * rows;
  const A = inPlaceOrder(a, cols), B = inPlaceOrder(b, cols);
  const nA = A.length, nB = B.length;
  const cx = cols / 2, cy = rows / 2;
  const waveAt = (x, y, j) => (Math.hypot(x - cx, y - cy) / rows) * WAVE_S + j * JITTER_S;

  // every cell has a time, so nothing is left behind: the field's own dots do not take part, only the sheets' (the shader
  // tells them apart), but a sheet's dot that was not in the set (a pointer pushed it there) still goes out and lands
  const outF = new Float32Array(cells), arrF = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    const x = i % cols, y = (i / cols) | 0, t = waveAt(x, y, hash(i * 0.37 + 5.1));
    outF[i] = t;
    arrF[i] = t + PAUSE_S + 0.9;
  }
  const moved = new Uint8Array(cells), landed = new Uint8Array(cells), stay = new Uint8Array(cells);
  const P = nA && nB ? Math.max(nA, nB) : 0;
  const from = [], to = [], par = [];
  let ends = 0;
  for (let k = 0; k < P; k++) {
    const sa = A[Math.floor((k * nA) / P)], sb = B[Math.floor((k * nB) / P)];
    const sx = sa % cols, sy = (sa / cols) | 0, dx = sb % cols, dy = (sb / cols) | 0;
    const d = Math.hypot(dx - sx, dy - sy);
    if (d < 0.5) {
      stay[sa] = 1; // already home: it does not go out and it does not land
      continue;
    }
    const h1 = hash(k), h2 = hash(k + 17.3), h3 = hash(k + 41.7), h4 = hash(k + 93.1);
    const delay = waveAt(sx, sy, h1), start = delay + PAUSE_S, land = start + walkTime(d, h2);
    if (!moved[sa] || delay < outF[sa]) outF[sa] = delay;
    moved[sa] = 1;
    if (!landed[sb] || land < arrF[sb]) arrF[sb] = land;
    landed[sb] = 1;
    if (land > ends) ends = land;
    if (h4 < walkers) {
      from.push(sx, sy);
      to.push(dx, dy);
      par.push(start, h2, h3, 0);
    }
  }
  const out = new Uint8Array(cells), arr = new Uint8Array(cells);
  const q = (t) => Math.max(0, Math.min(254, Math.round((t / SPAN) * 254)));
  for (let i = 0; i < cells; i++) {
    out[i] = stay[i] && !moved[i] ? 255 : q(outF[i]); // 255: this dot never goes out
    arr[i] = stay[i] && !landed[i] ? 0 : q(arrF[i]); // 0: it is there from the start
  }
  // a stay is a cell lit in both: it is also the destination of its own dot
  for (let i = 0; i < cells; i++) if (stay[i] && !landed[i]) arr[i] = 0;
  return {
    out, arr, stay,
    carriers: { n: from.length / 2, from: new Float32Array(from), to: new Float32Array(to), par: new Float32Array(par) },
    ends,
  };
}
