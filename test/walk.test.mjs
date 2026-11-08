// The walk between two sheets (walk.js): pairing by place, when each cell goes out and lands, which dots walk lit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOP_RATE, WALKERS, PAUSE_S, SPAN, TRAIL, walkTime, walkHops, GLSL_WALK, hash, morton, inPlaceOrder, pair } from "../walk.js";

const text = (p) => readFileSync(new URL(p, import.meta.url)).toString();
const COLS = 120, ROWS = 80;
/** a filled rectangle of cells, as indices */
const rect = (x0, y0, w, h) => {
  const a = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) a.push(y * COLS + x);
  return a;
};
const xy = (i) => [i % COLS, (i / COLS) | 0];

test("the walk's time and hops: the farther the longer, never long; the shader has the same numbers", () => {
  assert.ok(walkTime(0, 0) >= 0.45 * 0.85 - 1e-9, "never instant");
  assert.ok(walkTime(1e6, 1) <= 1.6 * 1.15 + 1e-9, "never long");
  assert.ok(walkTime(200, 0.5) > walkTime(20, 0.5), "farther takes longer");
  assert.equal(walkHops(1.0), HOP_RATE);
  assert.equal(walkHops(0.01), 1, "at least one hop");
  // the vertex shader's copy: the same clamp and the same spread (a test that it stays copied)
  assert.match(GLSL_WALK, /clamp\(cells \/ 110\.0, 0\.45, 1\.6\) \* \(0\.85 \+ 0\.3 \* h2\)/);
  assert.match(GLSL_WALK, /max\(1\.0, floor\(T \* uHop\)\)/);
  assert.equal(TRAIL, 3);
});

test("in place order: neighbours in the list are neighbours on the screen, far more than in a shuffle", () => {
  const cells = rect(10, 10, 60, 40);
  const sorted = inPlaceOrder(cells, COLS);
  assert.equal(sorted.length, cells.length);
  assert.deepEqual([...sorted].sort((p, q) => p - q), [...cells].sort((p, q) => p - q), "the same cells");
  const gap = (list) => {
    let s = 0;
    for (let i = 1; i < list.length; i++) { const [ax, ay] = xy(list[i - 1]), [bx, by] = xy(list[i]); s += Math.hypot(ax - bx, ay - by); }
    return s / (list.length - 1);
  };
  const shuffled = [...cells].sort((p, q) => hash(p * 3.1) - hash(q * 3.1));
  assert.ok(gap(sorted) < gap(shuffled) / 8, `sorted ${gap(sorted).toFixed(2)} cells apart on average, shuffled ${gap(shuffled).toFixed(2)}`);
  assert.equal(morton(0, 0), 0);
  assert.ok(morton(1, 0) !== morton(0, 1));
});

test("a small sheet and a big one are paired by proportion: left with left, top with top", () => {
  const small = rect(50, 30, 10, 10), big = rect(5, 5, 100, 60);
  const { carriers } = pair(small, big, COLS, ROWS, { walkers: 1 });
  let left = 0, leftTo = 0, n = carriers.n;
  for (let i = 0; i < n; i++) {
    if (carriers.from[i * 2] < 55) left++;
    if (carriers.to[i * 2] < 55) leftTo++;
  }
  // the left half of the small sheet's dots go to the left half of the big one's cells (any other way and they would cross)
  assert.ok(Math.abs(left / n - leftTo / n) < 0.1, `from-left ${(left / n).toFixed(2)}, to-left ${(leftTo / n).toFixed(2)}`);
});

test("pair: every dot gets a moment; a walker's dot goes out before it lands; times are monotone and bounded", () => {
  const a = rect(10, 20, 30, 20), b = rect(70, 30, 30, 20);
  const r = pair(a, b, COLS, ROWS);
  assert.equal(r.out.length, COLS * ROWS);
  assert.equal(r.arr.length, COLS * ROWS);
  const dec = (v) => (v / 254) * SPAN;
  for (const c of a) {
    assert.ok(r.out[c] <= 254, "a dot of the old sheet goes out");
    assert.ok(dec(r.out[c]) < SPAN);
  }
  for (const c of b) assert.ok(r.arr[c] <= 254 && r.arr[c] > 0, "a dot of the new sheet lands, at some time after the start");
  const { carriers } = r;
  for (let i = 0; i < carriers.n; i++) {
    const [sx, sy] = [carriers.from[i * 2], carriers.from[i * 2 + 1]], [dx, dy] = [carriers.to[i * 2], carriers.to[i * 2 + 1]];
    const start = carriers.par[i * 4];
    const land = start + walkTime(Math.hypot(dx - sx, dy - sy), carriers.par[i * 4 + 1]);
    assert.ok(start >= PAUSE_S, "it sets off after it has gone out");
    assert.ok(r.out[sy * COLS + sx] * SPAN / 254 <= start - PAUSE_S + 0.02, "its cell went out no later than it set off");
    assert.ok(r.arr[dy * COLS + dx] * SPAN / 254 <= land + 0.02, "and its destination lands no later than it arrives");
  }
  assert.ok(r.ends > 0.5 && r.ends < SPAN, `the last landing at ${r.ends.toFixed(2)} s, inside the span`);
});

test("the walkers are a share of the dots (a few, so you can follow them), and each is a real step", () => {
  const a = rect(10, 10, 40, 30), b = rect(60, 40, 40, 30);
  const r = pair(a, b, COLS, ROWS);
  const share = r.carriers.n / Math.max(a.length, b.length);
  assert.ok(Math.abs(share - WALKERS) < 0.03, `${(share * 100).toFixed(1)}% walk lit, the setting is ${WALKERS * 100}%`);
  assert.ok(WALKERS > 0.05 && WALKERS < 0.4, "well under half");
  const aSet = new Set(a), bSet = new Set(b);
  for (let i = 0; i < r.carriers.n; i++) {
    assert.ok(aSet.has(r.carriers.from[i * 2 + 1] * COLS + r.carriers.from[i * 2]), "it leaves from a dot of the old sheet");
    assert.ok(bSet.has(r.carriers.to[i * 2 + 1] * COLS + r.carriers.to[i * 2]), "to a cell of the new one");
  }
  const all = pair(a, b, COLS, ROWS, { walkers: 1 }), none = pair(a, b, COLS, ROWS, { walkers: 0 });
  assert.equal(none.carriers.n, 0);
  assert.equal(all.carriers.n, Math.max(a.length, b.length), "every pair walks lit when asked");
});

test("a dot that is lit in both sheets at the same cell stays: no walk, no going out", () => {
  const a = rect(20, 20, 20, 20);
  const r = pair(a, a, COLS, ROWS);
  assert.equal(r.carriers.n, 0);
  for (const c of a) {
    assert.equal(r.stay[c], 1);
    assert.equal(r.out[c], 255, "never goes out");
    assert.equal(r.arr[c], 0, "is there from the start");
  }
});

test("unequal sets: the bigger one sets the number of pairs, and nothing is left without a moment", () => {
  const few = rect(10, 10, 10, 10), many = rect(50, 10, 40, 30);
  const r = pair(few, many, COLS, ROWS, { walkers: 1 });
  assert.equal(r.carriers.n, many.length, "one walk for every cell of the bigger sheet");
  for (const c of many) assert.ok(r.arr[c] > 0 && r.arr[c] <= 254, "every cell of the new sheet lands");
  const r2 = pair(many, few, COLS, ROWS, { walkers: 1 });
  assert.equal(r2.carriers.n, many.length);
  for (const c of many) assert.ok(r2.out[c] < 255, "every dot of the old sheet goes out");
  assert.equal(pair([], many, COLS, ROWS).carriers.n, 0, "nothing to walk from");
  assert.equal(pair(few, [], COLS, ROWS).carriers.n, 0, "nothing to walk to");
});

test("the wave goes out from the middle of the screen through the old sheet", () => {
  const a = [...rect(50, 36, 6, 6), ...rect(5, 5, 6, 6)]; // one block at the middle, one in a corner
  const r = pair(a, rect(60, 40, 10, 10), COLS, ROWS);
  const mean = (cells) => cells.reduce((s, c) => s + r.out[c], 0) / cells.length;
  assert.ok(mean(rect(50, 36, 6, 6)) < mean(rect(5, 5, 6, 6)), "the middle goes out before the corner");
});

test("deterministic: the same sheets give the same walk", () => {
  const a = rect(10, 10, 30, 20), b = rect(60, 30, 30, 20);
  const p = pair(a, b, COLS, ROWS), q = pair(a, b, COLS, ROWS);
  assert.deepEqual([...p.out], [...q.out]);
  assert.deepEqual([...p.arr], [...q.arr]);
  assert.deepEqual([...p.carriers.par], [...q.carriers.par]);
});
