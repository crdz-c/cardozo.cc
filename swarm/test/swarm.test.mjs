// node --test swarm/test/*.test.mjs — the layers (pure maths: no DOM, no GL), the pixel setting, and what the page promises.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { N, BODY, LAYERS, FLAT, W, H, CAMERA_D, DENS_L, rng, pack, unpack, scatter, dust, fieldDensity, assemble, gridContext, cellCentre, ditherBody, cubeBody, sphereBody, columnBody, sortByPlace, rotation } from "../layers.js";
import { HOME_CELL, GRID, DUST_SHARE, cellCss, cellPx, gapPx, gridAmount, dustKeep } from "../density.js";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root)).toString();
const P = (a, i) => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2]];
const tone = (a, i) => unpack(a[i * 4 + 3]).tone;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const visible = (a) => Array.from({ length: BODY }, (_, i) => i).filter((i) => tone(a, i) > 0);

// a deterministic stand-in for the home's blue-noise map: a permutation of 0…255 ranks (the real one is made with Math.random)
const fakeBn = (() => {
  const a = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) a[i] = Math.round((255 * (((i * 2654435761) >>> 0) % 4096 + 0.5)) / 4096);
  return a;
})();
const ctx = gridContext({ viewW: 400, viewH: 300, cell: 3, bn: fakeBn }); // 134 × 100 cells (the flat layers)
const ctx3 = gridContext({ viewW: 2400, viewH: 1800, cell: 3, bn: fakeBn }); // a real screen's grid: a cell is 0.0033 world units (the 3D layers)
/** world (x, y) at z = 0 → the cell (cx, cy) it falls in */
const cellOf = (x, y) => [Math.floor((((x / ctx.aspect + 1) / 2) * ctx.viewW) / ctx.cell), Math.floor((((y + 1) / 2) * ctx.viewH) / ctx.cell)];

test("the texture holds exactly the dots, and the field is what is left over", () => {
  assert.equal(W * H, N);
  assert.equal(dust().length, (N - BODY) * 4);
  assert.equal(scatter().length, BODY * 4);
  assert.equal(assemble(cubeBody(ctx3), dust()).length, N * 4);
  assert.deepEqual(LAYERS, ["home", "ui", "picture", "cube", "sphere", "column"]);
  assert.ok([...FLAT].every((n) => LAYERS.includes(n)) && !FLAT.has("cube"));
});

test("a flat layer is the home's dither, cell by cell: lattice sites only, exactly at the cell's centre", () => {
  const a = ditherBody(() => 0.5, ctx, { solid: 2 });
  const vis = visible(a);
  assert.ok(vis.length > 0);
  for (const i of vis) {
    const [x, y] = P(a, i), [cx, cy] = cellOf(x, y);
    assert.equal((cx + cy) % 2, 0, "a lattice site");
    const [wx, wy] = cellCentre(ctx, cx, cy);
    assert.ok(Math.abs(x - wx) < 1e-5 && Math.abs(y - wy) < 1e-5, "at the centre of its cell");
  }
  // the home's rule: lit when tone × DENS_L passes the threshold, on half the cells: 0.36 of them, give or take the fade
  const share = vis.length / (ctx.cols * ctx.rows);
  assert.ok(share > 0.25 * DENS_L * 0.9 && share < 0.5 * DENS_L, `${(share * 100).toFixed(1)} % of the cells (the lattice is half of them, at 0.72 × 0.5 tone)`);
});

test("tone is density: a brighter tone lights more cells", () => {
  const n = (t) => visible(ditherBody(() => t, ctx, { solid: 2 })).length;
  const [lo, mid, hi] = [n(0.25), n(0.5), n(0.95)];
  assert.ok(lo < mid && mid < hi && hi > lo * 2.5, `${lo} < ${mid} < ${hi}`);
});

test("crisp lines and text: a cell at or above the solid tone is lit whatever its place, odd cells too", () => {
  const a = ditherBody((cx, cy) => (cx < 10 && cy < 10 ? 1 : 0), ctx, { solid: 0.55 });
  const vis = visible(a);
  assert.equal(vis.length, 100, "every cell of the 10 × 10 block");
  assert.ok(vis.some((i) => { const [x, y] = P(a, i), [cx, cy] = cellOf(x, y); return (cx + cy) % 2 === 1; }), "including the odd ones (a line is solid, not a dither)");
  assert.ok(vis.every((i) => tone(a, i) === unpack(pack(0, 1)).tone || tone(a, i) >= 0.995), "solid points are the brightest");
});

test("spares are not drawn (tone 0), the ids of an element survive the sort, and a layer is the same every time", () => {
  const a = ditherBody((cx, cy) => (cx > 20 && cx < 40 && cy > 20 && cy < 40 ? 1 : 0), ctx, { solid: 0.55, idAt: () => 3 });
  const vis = visible(a);
  assert.equal(vis.length, 19 * 19);
  assert.ok(BODY - vis.length > 0 && Array.from({ length: BODY }, (_, i) => i).filter((i) => tone(a, i) === 0).length === BODY - vis.length, "the rest are spares");
  assert.ok(vis.every((i) => unpack(a[i * 4 + 3]).id === 3), "ids survive the sort");
  assert.deepEqual(ditherBody((cx, cy) => (cx + cy) % 7 === 0 ? 0.6 : 0, ctx), ditherBody((cx, cy) => (cx + cy) % 7 === 0 ? 0.6 : 0, ctx));
});

test("relief does not move a flat layer: seen frontal, a raised dot still lands on its cell", () => {
  const a = ditherBody((cx, cy) => (cx === 60 && cy === 50 ? 1 : 0), ctx, { solid: 0.55, depth: 0.4 });
  const [i] = visible(a);
  const [x, y, z] = P(a, i);
  assert.ok(Math.abs(z - 0.2) < 1e-5, "raised by half the depth");
  const px = (x * CAMERA_D) / (CAMERA_D - z), py = (y * CAMERA_D) / (CAMERA_D - z);
  const [wx, wy] = cellCentre(ctx, 60, 50);
  assert.ok(Math.abs(px - wx) < 1e-5 && Math.abs(py - wy) < 1e-5, "projected, it is the cell's centre");
});

test("the dither is a pure function of the cell: the same grid and the same tone give the same dots", () => {
  const A = ditherBody(() => 0.4, ctx, { solid: 2 }), B = ditherBody(() => 0.4, ctx, { solid: 2 });
  assert.deepEqual(A, B);
  const c2 = gridContext({ viewW: 400, viewH: 300, cell: 6, bn: fakeBn });
  assert.ok(visible(ditherBody(() => 0.4, c2, { solid: 2 })).length < visible(A).length / 3, "bigger cells, fewer of them");
});

const BODIES = { cube: () => cubeBody(ctx3), sphere: () => sphereBody(ctx3), column: () => columnBody(ctx3) };
for (const [name, make] of Object.entries(BODIES)) {
  test(`${name}: BODY finite points, tone in [0, 1), inside the world, the same every time, mostly drawn`, () => {
    const a = make();
    assert.equal(a.length, BODY * 4);
    for (let i = 0; i < BODY; i++) {
      const [x, y, z] = P(a, i), { id, tone: t } = unpack(a[i * 4 + 3]);
      assert.ok(Number.isFinite(x + y + z), `finite at ${i}`);
      assert.ok(Math.abs(x) < 2 && Math.abs(y) < 2 && Math.abs(z) < 2, `inside the world at ${i}: ${x} ${y} ${z}`);
      assert.ok(t >= 0 && t < 1 && Number.isInteger(id), `tone and id at ${i}`);
    }
    assert.deepEqual(make(), a, "the same layer every time");
    assert.ok(visible(a).length > 8000, `a shape, not a speck (${visible(a).length} cells)`);
  });
}

test("sorted by place: dot i and dot i+1 are neighbours, far more than in a shuffle", () => {
  for (const name of Object.keys(BODIES)) {
    const a = BODIES[name](), r = rng(5);
    let near = 0, far = 0;
    for (let i = 0; i < 4000; i++) {
      const k = (r() * (BODY - 1)) | 0, j = (r() * BODY) | 0;
      near += dist(P(a, k), P(a, k + 1));
      far += dist(P(a, k), P(a, j));
    }
    assert.ok(near < far * 0.2, `${name}: neighbours ${near.toFixed(1)} vs random pairs ${far.toFixed(1)}`);
  }
  const raw = new Float32Array(400).map((_, i) => Math.sin(i * 12.9898) * 1.2);
  const sorted = sortByPlace(raw, 100);
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum(sorted) - sum(raw)) < 1e-3, "the same points, in another order");
});

test("cube: edges and corners are bright and crisp, the skin is a shell of half-size 0.44, a few dots are inside", () => {
  const a = cubeBody(ctx3), s = 0.44, vis = visible(a);
  let shell = 0, hot = 0;
  for (const i of vis) {
    if (Math.abs(Math.max(...P(a, i).map(Math.abs)) - s) < 0.02) shell++;
    if (tone(a, i) >= 0.995) hot++;
  }
  assert.ok(shell / vis.length > 0.7, `${((shell / vis.length) * 100).toFixed(0)} % on the shell`);
  assert.ok(hot / vis.length > 0.2 && hot / vis.length < 0.6, `${((hot / vis.length) * 100).toFixed(0)} % are edge or corner pixels`);
  assert.ok(vis.every((i) => Math.max(...P(a, i).map(Math.abs)) < s + 0.02), "nothing outside it: no blur, no halo");
});

test("sphere: every dot is on the skin (radius 0.66), and the veins and pools are the bright ones", () => {
  const a = sphereBody(ctx3), vis = visible(a);
  const on = vis.filter((i) => Math.abs(Math.hypot(...P(a, i)) - 0.66) < 0.01).length;
  assert.ok(on / vis.length > 0.97, `${((on / vis.length) * 100).toFixed(1)} % on the skin`);
  const hot = vis.filter((i) => tone(a, i) >= 0.995).length;
  assert.ok(hot / vis.length > 0.25 && hot / vis.length < 0.8, `veins and pools are ${((hot / vis.length) * 100).toFixed(0)} % of the dots`);
});

test("column: lit from the left, so the left half has more dots than the right", () => {
  const a = columnBody(ctx3);
  let left = 0, right = 0;
  for (const i of visible(a)) { const x = a[i * 4]; if (x < -0.02) left++; else if (x > 0.02) right++; }
  assert.ok(left > right * 1.1, `left ${left}, right ${right}`);
});

test("the field is noise over the WHOLE page, as the home's: more in the middle, a third of it at the edges, a few per cent of the cells", () => {
  const a = 1.6, d = dust(a), n = d.length / 4;
  // a grid of tiles over the screen: every tile has dots (no empty edges), and the middle ones have the most
  const TX = 8, TY = 6, tiles = new Array(TX * TY).fill(0);
  for (let i = 0; i < n; i++) {
    const tx = Math.min(TX - 1, Math.floor(((d[i * 4] / a + 1) / 2) * TX)), ty = Math.min(TY - 1, Math.floor(((d[i * 4 + 1] + 1) / 2) * TY));
    tiles[ty * TX + tx]++;
    assert.equal(d[i * 4 + 2], 0, "the field lies on the screen, in no depth: the camera does not turn it");
  }
  const lo = Math.min(...tiles), hi = Math.max(...tiles);
  assert.ok(lo > 0 && lo / hi > 0.15, `the emptiest tile has ${lo}, the fullest ${hi}: noise reaches the edges`);
  const centre = tiles[2 * TX + 3] + tiles[2 * TX + 4] + tiles[3 * TX + 3] + tiles[3 * TX + 4];
  assert.ok(centre / 4 > hi * 0.6, "and the fullest are in the middle");
  assert.ok(Math.abs(fieldDensity(0, 0, a) - 1) < 1e-9, "the profile peaks at the middle");
  const edge = fieldDensity(a, 0, a), corner = fieldDensity(a, 1, a);
  assert.ok(edge > 0.25 && edge < 0.5 && corner > 0.15 && corner < edge, `edges ${edge.toFixed(2)}, corner ${corner.toFixed(2)}: the home measured about 0.43 of the middle at the edge`);
  // the profile is the home's own rule (copied; if the home changes, this fails and the copy must follow)
  const hero = text("hero.js");
  assert.match(hero, /\(0\.06 \+ 0\.94 \* fieldAt\(p\)\) \* \(0\.35 \+ 0\.65 \* calm\)/, "hero.js densityAt");
  assert.match(hero, /lumC = \(0\.018 \+ 0\.05 \* D\)/, "hero.js lumC");
  const keep = dustKeep(ctx.cols, ctx.rows, n);
  assert.ok(keep * n <= DUST_SHARE * ctx.cols * ctx.rows + 1, "the share of the cells lit is the setting's");
  assert.ok(DUST_SHARE >= 0.02 && DUST_SHARE <= 0.04, "about the home's mean: faint, not sand, not bare");
});

test("rotation: the flat layers do not turn (they lie on the grid); a cube does", () => {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const flat = (m) => [...m].map((x) => x + 0); // (-0 is not 0 to deepEqual)
  for (const n of FLAT) assert.deepEqual(flat(rotation(n, 123)), I, `${n} at any time`);
  assert.notDeepEqual(flat(rotation("cube", 0)), flat(rotation("cube", 3)));
  const m = rotation("cube", 1.7);
  const col = (c) => [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.hypot(...col(c)) - 1) < 1e-5, "a rotation keeps lengths");
  assert.ok(Math.abs(col(0)[0] * col(1)[0] + col(0)[1] * col(1)[1] + col(0)[2] * col(1)[2]) < 1e-5, "and right angles");
});

test("pack and unpack agree", () => {
  for (const [id, t] of [[0, 0.5], [3, 0.999], [12, 0.001]]) {
    const u = unpack(pack(id, t));
    assert.equal(u.id, id);
    assert.ok(Math.abs(u.tone - t) < 1e-3);
  }
});

test("pixel setting: 0 is the home's cell, 1 is the screen's grid; in between only one way; no sand end", () => {
  assert.equal(HOME_CELL, 1.5, "the home's cell");
  assert.ok(Math.abs(cellCss(0) - HOME_CELL) < 1e-9 && Math.abs(cellCss(1) - GRID) < 1e-9);
  assert.equal(cellPx(0, 2), 3, "the home's rule on a 2× screen: round(1.5 × 2)");
  assert.equal(cellPx(0, 1), 2, "and never under 2 device px");
  assert.ok(Number.isInteger(cellPx(0.37, 3)), "a whole number of device px: dots are exact squares of cells");
  assert.equal(gapPx(3), 0, "fine cells touch, as the home's do");
  assert.ok(gapPx(36) >= 1, "big cells show the grid");
  assert.equal(gridAmount(0), 0);
  assert.equal(gridAmount(1), 1);
  let prev = [cellCss(0), gridAmount(0)];
  for (let g = 0.02; g <= 1.0001; g += 0.02) {
    const s = [cellCss(g), gridAmount(g)];
    assert.ok(s[0] >= prev[0] && s[1] >= prev[1], `up at ${g.toFixed(2)}`);
    prev = s;
  }
  assert.equal(cellCss(-3), cellCss(0), "clamped");
  assert.equal(cellCss(9), cellCss(1), "clamped");
  assert.ok(dustKeep(10, 10, 16384) < 0.001, "at the grid end a handful of field dots are lit: a few pixels");
});

test("the page is DOM first and unlisted: real elements, a canvas that is only a drawing, no scrolling, a switch and a pixel setting", () => {
  const page = text("swarm/index.html");
  assert.match(page, /<meta name="robots" content="noindex"/);
  assert.match(page, /<h1[^>]*data-id/, "the heading is a real element the canvas reads");
  assert.match(page, /<button[^>]*data-id/, "so are the buttons");
  assert.match(page, /<canvas[^>]*aria-hidden="true"/, "the canvas is hidden from screen readers");
  assert.match(page, /overflow:\s*hidden/, "nothing scrolls");
  assert.match(page, /<input[^>]*type="range"[^>]*id="pixel"|<input[^>]*id="pixel"[^>]*type="range"/, "the pixel setting is a real range input");
  assert.match(page, /id="prev"[\s\S]*id="next"/, "the switch between layers is real buttons");
  assert.match(page, /<iframe[^>]*id="ref"[^>]*hidden[^>]*title=|<iframe[^>]*id="ref"[^>]*title=[^>]*hidden/, "the home as the reference, in a frame, hidden until asked for");
  const rule = page.match(/html\.gl \.ui\s*\{[^}]*\}/)[0];
  assert.match(rule, /opacity:\s*0/, "with the canvas running the DOM is transparent…");
  assert.ok(!/display:\s*none|visibility:\s*hidden/.test(rule), "…never hidden");
  for (const f of ["index.html", "hero.js", "style.css", "brands.js", "disk/index.html", "disk/disk.js"]) assert.ok(!/swarm/i.test(text(f)), `${f} does not link to /swarm`);
});

test("the walk and the mouse: a straight line, hops, no spring; the click drops the wave and never switches layer", () => {
  const js = text("swarm/swarm.js");
  const update = js.match(/const UPDATE = `([\s\S]*?)`;/)[1];
  assert.match(update, /mix\(from, wn, pq\)/, "the shortest path: a straight line from where it left to where it goes");
  assert.match(update, /floor\(pw \* K \+ h3\) \/ K/, "a few cells at a time, each dot on its own beat");
  assert.ok(!/vel|spring|swirl|cross\(/.test(update), "no spring, no swirl: nothing overshoots or curves");
  assert.ok(!/^\s*addEventListener\("click"/m.test(js), "the window's click does not switch layer");
  assert.match(js, /dropWave\(ndcOf\(e\)\)/, "a click on empty space drops the wave");
  assert.match(js, /cam\.yaw \+= dx \* 0\.007/, "a drag turns");
  assert.match(js, /getElementById\("next"\)\.addEventListener\("click", \(\) => goto\(layerIdx \+ 1\)\)/, "the switch button changes layer");
});

test("the walk you can follow: they go out where they stand, a few stay lit and leave a trail, the others walk in the dark", () => {
  const js = text("swarm/swarm.js");
  const update = js.match(/const UPDATE = `([\s\S]*?)`;/)[1];
  const draw = js.match(/const DRAW_V = `([\s\S]*?)`;/)[1];
  // one walk for both shaders: the draw finds a dot's trail with the same time and hops the update moves it by
  const walk = js.match(/const WALK = `([\s\S]*?)`;/)[1];
  assert.match(walk, /float walkTime\(/);
  assert.match(walk, /float walkHops\(/);
  assert.ok(update.includes("${WALK}") && draw.includes("${WALK}"), "both shaders take the walk from the one place");
  assert.ok(!/clamp\(cells/.test(update + draw), "nor does either keep a copy of its own");
  // going out comes first: the dot stands for uPause of the walk, stuttering, before it moves
  assert.match(update, /\(min\(p, 1\.0\) - uPause\) \/ \(1\.0 - uPause\)/, "the walk starts after the dot has gone out");
  assert.match(draw, /float going = walking \* \(1\.0 - step\(uPause, p\)\)/);
  assert.match(draw, /step\(fract\(u \* 9\.0 \+ h3\), 1\.0 - u\)/, "going out: lit less and less often");
  // carriers: a share of the dots stays lit on the way; the rest are dark (uDim) and light up when they arrive
  assert.match(draw, /bool carrier = h4 < uWalkers/);
  assert.match(draw, /mix\(uDim \* b, 0\.95, float\(carrier\)\)/, "a carrier is lit and even; the others are uDim");
  assert.match(js, /walkers: knob\("walkers", 0\.1\d?\d?,/, "a share well under half: you can tell them apart");
  assert.match(js, /dim: knob\("dim", 0,/, "the others are dark by default");
  // the trail: where the dot was one hop ago, two, three, from the same line; only for carriers, only while they walk
  assert.match(draw, /int g = gl_VertexID \/ n/, "the trail is more vertices of the same dots");
  assert.match(draw, /mix\(fr\.xyz, to\.xyz, max\(0\.0, to\.w - float\(g\) \/ K\)\)/, "the previous hops of the straight line");
  assert.match(draw, /gone = gone \|\| !carrier \|\| onway < 0\.5/);
  assert.match(js, /gl\.drawArrays\(gl\.POINTS, 0, N \* \(1 \+ \(since < WALK_SPAN && !reduce \? walk\.trail : 0\)\)\)/, "trails only while something walks, and never in reduced motion");
  // the wave goes through the picture the dots are leaving (their own place), not the one they are going to
  assert.match(update, /distance\(hold\.xy, uClick\)/);
});

test("the field is the page's noise: the camera does not turn it and the fog does not dim it", () => {
  const draw = text("swarm/swarm.js").match(/const DRAW_V = `([\s\S]*?)`;/)[1];
  assert.match(draw, /if \(field\) q = sp;/);
  assert.match(draw, /uFog \* \(field \? 0\.0 : 1\.0\)/);
});
