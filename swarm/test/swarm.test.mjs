// node --test swarm/test/*.test.mjs — the layers (pure maths: no DOM, no GL) and the pixel setting.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { N, BODY, LAYERS, W, H, rng, pack, unpack, scatter, dust, assemble, bitmapBody, cubeBody, sphereBody, columnBody, sortByPlace, rotation } from "../layers.js";
import { FINE, GRID, KEEP_MIN, cellSize, keepFraction, snapAmount, squareness, alphaGain, tonePower, dustBoost, gridAmount, pixelSetting } from "../density.js";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root)).toString();
const P = (a, i) => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// a bitmap with one white rectangle (pixels 20..59 × 30..49) on black, 100 × 80
function rectBitmap() {
  const w = 100, h = 80, data = new Uint8Array(w * h * 4);
  for (let y = 30; y < 50; y++) for (let x = 20; x < 60; x++) data.set([255, 255, 255, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}

const BODIES = {
  cube: () => cubeBody(),
  sphere: () => sphereBody(),
  column: () => columnBody(),
  ui: () => bitmapBody(rectBitmap(), { worldH: 2, count: 30000, regions: [{ id: 3, x: 20, y: 30, w: 20, h: 20 }] }),
  cosmos: () => bitmapBody(rectBitmap(), { worldH: 1.7, count: 60000, depth: 0.25 }),
};

test("the texture holds exactly the dots, and the dust is what is left over", () => {
  assert.equal(W * H, N);
  assert.equal(dust().length, (N - BODY) * 4);
  assert.equal(scatter().length, BODY * 4);
  assert.equal(assemble(cubeBody(), dust()).length, N * 4);
  assert.deepEqual(LAYERS, ["ui", "cosmos", "cube", "sphere", "column"]);
});

for (const [name, make] of Object.entries(BODIES)) {
  test(`${name}: BODY finite points, tone in [0, 1), inside the world, the same every time`, () => {
    const a = make();
    assert.equal(a.length, BODY * 4);
    for (let i = 0; i < BODY; i++) {
      const [x, y, z] = P(a, i), { id, tone } = unpack(a[i * 4 + 3]);
      assert.ok(Number.isFinite(x + y + z), `finite at ${i}`);
      assert.ok(Math.abs(x) < 3 && Math.abs(y) < 3 && Math.abs(z) < 3, `inside the world at ${i}: ${x} ${y} ${z}`);
      assert.ok(tone >= 0 && tone < 1 && Number.isInteger(id), `tone and id at ${i}`);
    }
    assert.deepEqual(make(), a, "the same seed gives the same layer");
  });
}

test("sorted by place: dot i and dot i+1 are neighbours, far more than in a shuffle", () => {
  for (const name of ["cube", "sphere", "column"]) {
    const a = BODIES[name]();
    const r = rng(5);
    let near = 0, far = 0;
    for (let i = 0; i < 4000; i++) {
      const k = (r() * (BODY - 1)) | 0, j = (r() * BODY) | 0;
      near += dist(P(a, k), P(a, k + 1));
      far += dist(P(a, k), P(a, j));
    }
    assert.ok(near < far * 0.2, `${name}: neighbours ${near.toFixed(1)} vs random pairs ${far.toFixed(1)}`);
  }
  // and the sort keeps every point (nothing lost, nothing made)
  const raw = new Float32Array(400).map((_, i) => Math.sin(i * 12.9898) * 1.2);
  const sorted = sortByPlace(raw, 100);
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum(sorted) - sum(raw)) < 1e-3, "the same points, in another order");
});

test("cube: most dots sit on an edge, a corner or a face of a cube of half-size 0.44", () => {
  const a = cubeBody(), s = 0.44;
  let onShell = 0;
  for (let i = 0; i < BODY; i++) {
    const m = P(a, i).map(Math.abs);
    const outside = Math.max(...m);
    if (Math.abs(outside - s) < 0.04) onShell++;
  }
  assert.ok(onShell / BODY > 0.6, `${((onShell / BODY) * 100).toFixed(0)} % on the shell`);
  assert.ok(Math.max(...P(a, 0).map(Math.abs)) < 0.6 && Math.max(...Array.from({ length: 50 }, (_, i) => Math.max(...P(a, i * 1000).map(Math.abs)))) < 0.6, "none far outside");
});

test("sphere: the skin is at radius 0.66, the veins are brighter than the skin", () => {
  const a = sphereBody();
  let onSkin = 0, bright = 0;
  for (let i = 0; i < BODY; i++) {
    const rad = Math.hypot(...P(a, i));
    if (Math.abs(rad - 0.66) < 0.06) onSkin++;
    if (unpack(a[i * 4 + 3]).tone > 0.8) bright++;
  }
  assert.ok(onSkin / BODY > 0.9, `${((onSkin / BODY) * 100).toFixed(0)} % on the skin`);
  assert.ok(bright / BODY > 0.35 && bright / BODY < 0.6, `veins and pools are ${((bright / BODY) * 100).toFixed(0)} % of the dots`);
});

test("column: lit from the left, so the left half has more dots than the right", () => {
  const a = columnBody();
  let left = 0, right = 0;
  for (let i = 0; i < BODY; i++) { const x = a[i * 4]; if (x < -0.02) left++; else if (x > 0.02) right++; }
  assert.ok(left > right * 1.2, `left ${left}, right ${right}`);
});

test("bitmap: dots land inside the lit pixels (plus the haze), and a region gives its element id", () => {
  const a = BODIES.ui(), sc = 2 / 80;
  let inside = 0, ids = 0, strong = 0;
  for (let i = 0; i < BODY; i++) {
    const px = a[i * 4] / sc + 50, py = -a[i * 4 + 1] / sc + 40, { id, tone } = unpack(a[i * 4 + 3]);
    if (tone > 0.5) { strong++; if (px >= 19.9 && px < 60.1 && py >= 29.9 && py < 50.1) inside++; }
    if (id === 3) { ids++; assert.ok(px < 43 && py >= 27 && py < 53, "id 3 only in its region (the haze may spill a few pixels)"); }
  }
  assert.equal(inside, strong, "every strong dot is inside the rectangle");
  assert.ok(ids > 4000, `the region has dots (${ids})`);
  const half = BODIES.ui();
  const idsLeft = Array.from({ length: BODY }, (_, i) => unpack(half[i * 4 + 3]).id === 3).filter(Boolean).length;
  assert.equal(idsLeft, ids, "ids survive the sort");
});

test("bitmap: tone is density (a bright half gets more dots than a dim half)", () => {
  const w = 100, h = 40, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < 50 ? 255 : 90; data.set([v, v, v, 255], (y * w + x) * 4); }
  const a = bitmapBody({ data, width: w, height: h }, { worldH: 0.8, count: 50000, haze: [0.001, 0.2] });
  let bright = 0, dim = 0;
  for (let i = 0; i < BODY; i++) { if (a[i * 4] < 0) bright++; else dim++; }
  assert.ok(bright > dim * 2, `bright half ${bright}, dim half ${dim}`);
});

test("rotation: the interface never turns; a cube does", () => {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const flat = (m) => [...m].map((x) => x + 0); // (-0 is not 0 to deepEqual)
  assert.deepEqual(flat(rotation("ui", 0)), I);
  assert.deepEqual(flat(rotation("ui", 123)), I, "the same at any time");
  assert.notDeepEqual([...rotation("cube", 0)], [...rotation("cube", 3)]);
  const m = rotation("cube", 1.7);
  const col = (c) => [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.hypot(...col(c)) - 1) < 1e-5, "a rotation keeps lengths");
  assert.ok(Math.abs(col(0)[0] * col(1)[0] + col(0)[1] * col(1)[1] + col(0)[2] * col(1)[2]) < 1e-5, "and keeps right angles");
});

test("pack and unpack agree", () => {
  for (const [id, tone] of [[0, 0.5], [3, 0.999], [12, 0.001]]) {
    const u = unpack(pack(id, tone));
    assert.equal(u.id, id);
    assert.ok(Math.abs(u.tone - tone) < 1e-3);
  }
});

test("pixel setting: 0 is fine dust, 1 is the screen's grid with a few squares; in between it only goes one way", () => {
  assert.ok(Math.abs(cellSize(0) - FINE) < 1e-9 && Math.abs(cellSize(1) - GRID) < 1e-9);
  const lo = pixelSetting(0), hi = pixelSetting(1);
  assert.deepEqual([lo.keep, lo.snap, lo.square, lo.gain, lo.power, lo.dust, lo.grid], [1, 0, 0, 1, 1, 1, 0], "0: every dot, free, round, nothing lifted, no grid");
  assert.ok(Math.abs(hi.keep - KEEP_MIN) < 1e-9 && hi.snap === 1 && hi.square === 1 && hi.grid === 1 && hi.dust > 2 && hi.gain < 0.6 && hi.power < 0.6, "1: a twentieth of the dots, snapped, square, the grid showing, the dust lifted");
  assert.ok(KEEP_MIN <= 0.05, "few pixels");
  let prev = pixelSetting(0);
  for (let g = 0.02; g <= 1.0001; g += 0.02) {
    const s = pixelSetting(g);
    assert.ok(s.cell >= prev.cell && s.keep <= prev.keep && s.snap >= prev.snap && s.square >= prev.square && s.grid >= prev.grid && s.dust >= prev.dust, `up at ${g.toFixed(2)}`);
    assert.ok(s.gain <= prev.gain && s.power <= prev.power, `down at ${g.toFixed(2)}`);
    prev = s;
  }
  assert.equal(cellSize(-3), cellSize(0), "clamped");
  assert.equal(cellSize(9), cellSize(1), "clamped");
  assert.ok([keepFraction, snapAmount, squareness, alphaGain, tonePower, dustBoost, gridAmount].every((f) => Number.isFinite(f(0.5))));
});

test("the page is DOM first and unlisted: real elements, a canvas that is only a drawing, no scrolling, no links out", () => {
  const page = text("swarm/index.html");
  assert.match(page, /<meta name="robots" content="noindex"/);
  assert.match(page, /<h1[^>]*data-id/, "the heading is a real element the canvas reads");
  assert.match(page, /<button[^>]*data-id/, "so are the buttons");
  assert.match(page, /<canvas[^>]*aria-hidden="true"/, "the canvas is hidden from screen readers");
  assert.match(page, /overflow:\s*hidden/, "nothing scrolls");
  assert.match(page, /<input[^>]*type="range"[^>]*id="pixel"|<input[^>]*id="pixel"[^>]*type="range"/, "the pixel setting is a real range input");
  const rule = page.match(/html\.gl \.ui\s*\{[^}]*\}/)[0];
  assert.match(rule, /opacity:\s*0/, "with the canvas running the DOM is transparent…");
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(rule), "…never hidden");
  for (const f of ["index.html", "hero.js", "style.css", "brands.js", "disk/index.html", "disk/disk.js"]) assert.ok(!/swarm/i.test(text(f)), `${f} does not link to /swarm`);
});
