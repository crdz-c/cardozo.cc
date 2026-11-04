// cardozo.cc — raster helpers: exact distance transforms, corner rounding, a blue-noise threshold map.

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance in texels from every texel
// to the nearest texel where mask === seed (0 there). Exact circles matter: the corner rounding below is
// an opening/closing by a disc, and a chamfer metric would round corners into octagons.
export function distanceTransform(mask, w, h, seed) {
  const INF = 1e20;
  const n = w * h;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = mask[i] === seed ? 0 : INF;
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const out = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  const pass = (count) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < count; q++) {
      let sx = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (sx <= z[k]) {
        k--;
        sx = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = sx;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = d[row + x];
    pass(w);
    for (let x = 0; x < w; x++) d[row + x] = out[x];
  }
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.sqrt(d[i]);
  return r;
}

// Round every corner of a binary mask: an opening by a disc of radius rOpen rounds the convex corners
// (Z's points, the C terminals, R's leg), a closing by rClose rounds the concave ones (R's notch, the
// inside corners of D and Z). Stroke widths and counters wider than the discs are left as they are.
export function roundCorners(solid, w, h, rOpen, rClose) {
  const n = w * h;
  let m = new Uint8Array(n);
  let dIn = distanceTransform(solid, w, h, 0);
  for (let i = 0; i < n; i++) m[i] = dIn[i] > rOpen ? 1 : 0; // erode
  let dOut = distanceTransform(m, w, h, 1);
  for (let i = 0; i < n; i++) m[i] = dOut[i] <= rOpen ? 1 : 0; // dilate → opened
  dOut = distanceTransform(m, w, h, 1);
  for (let i = 0; i < n; i++) m[i] = dOut[i] <= rClose ? 1 : 0; // dilate
  dIn = distanceTransform(m, w, h, 0);
  for (let i = 0; i < n; i++) m[i] = dIn[i] > rClose ? 1 : 0; // erode → closed
  return m;
}

// ------------------------------------------------------------------ blue noise
// A 64×64 threshold map made at load with void-and-cluster (Ulichney): every threshold rank goes to the
// emptiest spot left, so lit cells spread evenly at any density, with no lattice and no diagonal
// streaks. ~4k × 4k cheap updates: a few tens of milliseconds, once.
export function blueNoise(N = 64, sigma = 1.6) {
  const n = N * N;
  const kernel = new Float32Array(n); // toroidal gaussian, indexed by (dy * N + dx)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - x);
      const dy = Math.min(y, N - y);
      kernel[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  const energy = new Float32Array(n);
  const on = new Uint8Array(n);
  const splat = (i, sign) => {
    const px = i % N;
    const py = (i / N) | 0;
    for (let y = 0; y < N; y++) {
      const ky = ((y - py + N) % N) * N;
      const row = y * N;
      for (let x = 0; x < N; x++) energy[row + x] += sign * kernel[ky + ((x - px + N) % N)];
    }
  };
  const extreme = (wantOn, max) => {
    let best = -1;
    let bv = max ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if (on[i] !== wantOn) continue;
      const v = energy[i];
      if (max ? v > bv : v < bv) {
        bv = v;
        best = i;
      }
    }
    return best;
  };

  // initial pattern: ~10% random seeds, relaxed by moving the tightest cluster into the largest void
  const seeds = Math.round(n * 0.1);
  for (let k = 0; k < seeds; ) {
    const i = (Math.random() * n) | 0;
    if (!on[i]) {
      on[i] = 1;
      splat(i, 1);
      k++;
    }
  }
  for (let guard = 0; guard < n; guard++) {
    const c = extreme(1, true);
    on[c] = 0;
    splat(c, -1);
    const v = extreme(0, false);
    on[v] = 1;
    splat(v, 1);
    if (v === c) break;
  }

  const rank = new Uint16Array(n);
  // phase 1: peel the seeds off, tightest cluster first
  const saveOn = on.slice();
  const saveE = energy.slice();
  for (let r = seeds - 1; r >= 0; r--) {
    const c = extreme(1, true);
    on[c] = 0;
    splat(c, -1);
    rank[c] = r;
  }
  on.set(saveOn);
  energy.set(saveE);
  // phase 2: fill the largest voids until every cell has a rank
  for (let r = seeds; r < n; r++) {
    const v = extreme(0, false);
    on[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(((rank[i] + 0.5) / n) * 255);
  return out;
}
