// lab/test/browser.js — the tests that need a browser: WebGL, the canvas, pointer events, the font. Open /lab/test/ (serve the repo
// root over http); the results are listed on the page, `document.title` says PASS or FAIL, and window.__tests has them.
// Nothing here waits on animation frames or the clock: the engine is stepped (lab.step(ms)) and the pointer tests run on a virtual
// performance.now, so it passes the same in a background tab or a hidden pane.
//
// The engine draws at 1× (?dpr=1): an 800 × 600 canvas, a cell is 2 px, 400 × 300 cells.
import { createEngine } from "../engine.js";
import { MODELS } from "../models/index.js";
import { qaxis, qmul, qnorm, qangle } from "../math.js";

const canvas = document.getElementById("c");
const out = document.getElementById("out");
const W = 800;
const H = 600;
const CELL = 2;

// ------------------------------------------------------------------ a tiny harness
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const fails = (msg) => {
  throw new Error(msg);
};
const ok = (cond, msg) => cond || fails(msg);
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);
const between = (a, lo, hi, msg) => ok(a >= lo && a <= hi, `${msg ?? ""} expected ${lo} … ${hi}, got ${a}`);

// errors the page raises on its own (a test that provokes one on purpose wraps it in expectError)
const errors = [];
addEventListener("error", (e) => errors.push(e.message));
addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
const consoleError = console.error;
let expecting = null;
console.error = (...a) => {
  if (expecting) expecting.push(a.join(" "));
  else errors.push(a.join(" "));
  consoleError(...a);
};
async function expectError(fn) {
  expecting = [];
  try {
    await fn();
  } finally {
    const seen = expecting;
    expecting = null;
    return seen;
  }
}

// ------------------------------------------------------------------ the engine, and ways to look at what it drew
const lab = createEngine({ canvas, query: new URLSearchParams("dpr=1") });
lab.resize();

const rb = document.createElement("canvas");
rb.width = W;
rb.height = H;
const rbx = rb.getContext("2d", { willReadFrequently: true });
function shot() {
  lab.draw();
  rbx.drawImage(canvas, 0, 0);
  return rbx.getImageData(0, 0, W, H);
}
const lit = (img, x, y) => img.data[(y * W + x) * 4] > 40;
function extent(img) {
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lit(img, x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
// the share of lit pixels in the ring r0 … r1 around (cx, cy)
function ring(img, cx, cy, r0, r1) {
  let n = 0, l = 0;
  for (let y = Math.max(0, cy - r1 | 0); y < Math.min(H, cy + r1); y++) {
    for (let x = Math.max(0, cx - r1 | 0); x < Math.min(W, cx + r1); x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r >= r0 && r < r1) { n++; if (lit(img, x, y)) l++; }
    }
  }
  return l / n;
}
const share = (img) => { let l = 0; for (let i = 0; i < W * H; i++) if (img.data[i * 4] > 40) l++; return l / (W * H); };

// every dot of the plate lit: no field, no lattice, density far above 1, full levels
const SOLID = { field: 0, lattice: 0, dens: 3, black: 0, white: 1, shade: 0 };
const whiteSquare = (c, t, w, h) => { c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); };
const model = (params, source) => ({ id: "test", params: { spin: 0, rx: 0, ry: 0, build: 0, ...SOLID, ...params }, create: async () => ({ name: "test", ...source }) });
const card = (params) => model(params, { draw: whiteSquare });
const disc = (hole, params) => model(params, { draw: whiteSquare, plate: { disc: true, ax: 1, ay: 1, hole, half: [1, 1] } });
const dataURL = (w, h, paint) => { const c = document.createElement("canvas"); c.width = w; c.height = h; paint(c.getContext("2d"), w, h); return c.toDataURL("image/png"); };

// the pointer, on a virtual clock
const box = () => canvas.getBoundingClientRect();
const ptr = (type, x, y, id = 1) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "mouse", isPrimary: id === 1, clientX: box().left + x, clientY: box().top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
async function virtualClock(fn) {
  const real = performance.now.bind(performance);
  let now = 1000;
  performance.now = () => now;
  try {
    await fn((ms) => { now += ms; lab.step(ms); });
  } finally {
    performance.now = real;
  }
}
const key = (k) => dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : k, bubbles: true }));
const homeQ = (rx, ry) => qnorm(qmul(qaxis(1, 0, 0, (rx * Math.PI) / 180), qaxis(0, 1, 0, (ry * Math.PI) / 180)));
const deg = (rad) => (rad * 180) / Math.PI;

// ================================================================== the plate
test("the CD renders: neither blank nor solid", async () => {
  await lab.useModel(MODELS.cd);
  Object.assign(lab.P, { build: 0, field: 0 });
  lab.pose(0, 0);
  lab.step(3000);
  between(share(shot()), 0.04, 0.4, "share of lit pixels");
});

test("a square card at home takes `size` of the screen and sits in the middle", async () => {
  await lab.useModel(card({ size: 0.8 }));
  lab.step(16);
  const e = extent(shot());
  between(e.w, 0.8 * H - 12, 0.8 * H + 12, "width");
  between(e.h, 0.8 * H - 12, 0.8 * H + 12, "height");
  near(e.cx, W / 2, 3, "centre x");
  near(e.cy, H / 2, 3, "centre y");
});

test("turned 60° about the vertical, a card foreshortens to about cos 60° of its width and grows taller", async () => {
  await lab.useModel(card({ size: 0.8 }));
  lab.step(16);
  const flat = extent(shot());
  lab.pose(0, 60);
  lab.step(16);
  const turned = extent(shot());
  between(turned.w / flat.w, 0.45, 0.6, "width ratio");
  ok(turned.h > flat.h, "the nearer edge looks taller (perspective)");
});

test("the CD is as thick as a real CD: edge-on, 0.01 of its diameter; three times the thickness, three times the edge", async () => {
  const edge = async (thick) => {
    await lab.useModel(MODELS.cd);
    Object.assign(lab.P, { ...SOLID, build: 0, spin: 0, thick });
    lab.pose(0, 90);
    lab.step(16);
    return extent(shot());
  };
  const real = await edge(0.02);
  between(real.w / real.h, 0.007, 0.016, "edge width over diameter (a real CD: 0.01)");
  const triple = await edge(0.06);
  between(triple.w / real.w, 2.2, 4.2, `three times the thickness (${real.w} px against ${triple.w}: the edge is a few 2 px cells wide)`);
});

test("a disc's hole is empty: nothing prints inside it, and nothing outside the rim", async () => {
  await lab.useModel(disc(0.3));
  lab.step(16);
  const img = shot();
  const R = 0.4 * H; // size 0.8 of the shorter side: the disc's diameter
  ok(ring(img, W / 2, H / 2, 0, 0.25 * R) < 0.01, "the hole is dark");
  ok(ring(img, W / 2, H / 2, 0.4 * R, 0.95 * R) > 0.85, "the disc is solid");
  ok(ring(img, W / 2, H / 2, 1.08 * R, 1.3 * R) < 0.01, "nothing beyond the rim");
});

test("the hero's lattice: bright areas print on a checkerboard, so about half the cells are lit", async () => {
  await lab.useModel(card({ lattice: 1, dens: 3 }));
  lab.step(16);
  const img = shot();
  const inner = ring(img, W / 2, H / 2, 0, 0.3 * H);
  between(inner, 0.4, 0.6, "lit share of the plate");
});

// ================================================================== the wave
test("a click's wave sends two rings, 0.2 s apart, that cross the plate, then everything comes back", async () => {
  await lab.useModel(card({ size: 0.8, dens: 1.05 })); // (a density that lets a ring show its width: 3 would saturate it)
  lab.step(16);
  const cx = W / 2;
  const cy = H / 2;
  const front = (age) => (age * 1.05 - 0.07) * H; // the cancelling band: 1.05 screen heights a second, 0.07 behind the front
  const band = (img, age) => ring(img, cx, cy, front(age) - 8, front(age) + 8);
  const base = ring(shot(), cx, cy, 85, 120);
  ok(base > 0.95, `the card is solid before the wave (${base})`);
  lab.wave();
  lab.step(230);
  ok(band(shot(), 0.23) < 0.5 * base, `the first ring is open at r ≈ ${front(0.23) | 0} (${band(shot(), 0.23).toFixed(2)})`);
  lab.step(190); // age 0.42; the second pulse left 0.2 s later, so it is 0.22 old
  const later = shot();
  ok(band(later, 0.42) < 0.5 * base, `the first has moved out to r ≈ ${front(0.42) | 0} (${band(later, 0.42).toFixed(2)})`);
  ok(band(later, 0.22) < 0.5 * base, `the second is at r ≈ ${front(0.22) | 0} (${band(later, 0.22).toFixed(2)})`);
  ok(ring(later, cx, cy, 150, 170) > 0.9 * base, `and between them the plate is whole (${ring(later, cx, cy, 150, 170).toFixed(2)})`);
  lab.step(3600); // past a wave's whole life (3.2 s)
  ok(lab.info().waves === 0, "the waves are gone");
  ok(ring(shot(), cx, cy, 85, 120) > 0.95 * base, "the plate is whole again");
});

test("a wave sends two pulses and stirs the sea, which settles in ~3 s", async () => {
  await lab.useModel(card({}));
  lab.step(4000);
  lab.wave(100, 100);
  ok(lab.info().waves === 2, "two pulses");
  near(lab.info().energy, 0.85, 1e-9, "the energy");
  lab.step(2800);
  between(lab.info().energy, 0.25, 0.4, "after 2.8 s it is ≈ 0.85/e");
});

test("a model put on after the CD does not inherit its turn", async () => {
  await lab.useModel(MODELS.cd);
  lab.step(5000); // 40°/s: well over a quarter turn
  await lab.useModel(card({ size: 0.8 }));
  lab.step(16);
  const e = extent(shot());
  between(e.w, 0.8 * H - 12, 0.8 * H + 12, "an upright square is as wide as it is tall: no turn left over");
  between(e.h, 0.8 * H - 12, 0.8 * H + 12, "height");
});

// ================================================================== turning
test("dragging turns the model by the angle the README says, with the shown pose a little behind; letting go glides and stops", async () => {
  await lab.useModel(MODELS.cd);
  Object.assign(lab.P, { build: 0, spin: 0 });
  lab.pose(0, 0);
  lab.step(16);
  const q0 = lab.view.q.slice();
  await virtualClock((tick) => {
    ptr("pointerdown", 300, 300);
    for (let i = 1; i <= 8; i++) { tick(15); ptr("pointermove", 300 + i * 20, 300); } // 160 px in 120 ms
    tick(16);
    const wanted = deg(qangle(q0, lab.view.qt));
    near(wanted, deg((160 * 3.4) / H), 1.5, "the wanted turn: 160 px of a 600 px side at 3.4 rad a side");
    const shown = deg(qangle(q0, lab.view.q));
    ok(shown > 5 && shown < wanted - 0.5, `the shown pose follows, behind (${shown.toFixed(1)}° of ${wanted.toFixed(1)}°)`);
    ok(lab.view.drag, "dragging");
    ok(lab.view.qt[1] > 0.3 && Math.abs(lab.view.qt[0]) < 0.01, "dragging right turns about +y (the near side goes right)");
    ptr("pointerup", 460, 300);
    ok(!lab.view.drag, "let go");
    const atRelease = deg(qangle(q0, lab.view.qt));
    const speed = Math.hypot(...lab.view.w);
    between(speed, 2, 12, "the release speed (rad/s)");
    tick(3000);
    ok(Math.hypot(...lab.view.w) < 0.03, "it has stopped");
    near(deg(qangle(lab.view.q, lab.view.qt)), 0, 0.2, "the shown pose has caught up");
    ok(deg(qangle(q0, lab.view.qt)) > atRelease + 20, "it glided on after the release");
  });
});

test("dragging down turns about +x, left about −y, and the shown pose is the same turn", async () => {
  await lab.useModel(MODELS.cd);
  lab.pose(0, 0);
  lab.turn(0, 100);
  ok(lab.view.qt[0] > 0.2 && Math.abs(lab.view.qt[1]) < 1e-9, "down: about +x");
  lab.pose(0, 0);
  lab.turn(-100, 0);
  ok(lab.view.qt[1] < -0.2 && Math.abs(lab.view.qt[0]) < 1e-9, "left: about −y");
  near(deg(qangle(lab.view.q, lab.view.qt)), deg((100 * 3.4) / H), 0.5, "the wanted pose is 100 px of drag away from the shown one");
});

test("a press that does not move is a tap: it sends the wave and turns nothing", async () => {
  await lab.useModel(MODELS.cd);
  lab.step(4000);
  lab.pose(0, 0);
  const q0 = lab.view.qt.slice();
  await virtualClock((tick) => {
    ptr("pointerdown", 500, 400);
    tick(40);
    ptr("pointerup", 500, 400);
  });
  ok(lab.info().waves === 2, "a wave");
  near(deg(qangle(q0, lab.view.qt)), 0, 1e-6, "no turn");
});

test("a long press is not a tap, and neither is a press that moves", async () => {
  await lab.useModel(MODELS.cd);
  lab.step(4000);
  await virtualClock((tick) => {
    ptr("pointerdown", 500, 400);
    tick(600);
    ptr("pointerup", 500, 400);
    ok(lab.info().waves === 0, "a 600 ms press sends no wave");
    ptr("pointerdown", 500, 400);
    tick(20);
    ptr("pointermove", 530, 400);
    tick(20);
    ptr("pointerup", 530, 400);
    ok(lab.info().waves === 0, "a drag sends no wave");
  });
});

test("held still before letting go there is no glide", async () => {
  await lab.useModel(MODELS.cd);
  lab.pose(0, 0);
  await virtualClock((tick) => {
    ptr("pointerdown", 300, 300);
    for (let i = 1; i <= 6; i++) { tick(15); ptr("pointermove", 300 + i * 20, 300); }
    tick(200); // rests
    ptr("pointerup", 420, 300);
    ok(Math.hypot(...lab.view.w) === 0, "no velocity kept");
  });
});

test("the wheel and a pinch move the camera, within limits; scrolling down moves in", async () => {
  await lab.useModel(MODELS.cd);
  lab.home();
  const wheel = (deltaY, ctrlKey = false) => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true }));
  wheel(200);
  near(lab.view.lzt, 0.36, 1e-3, "200 px of scroll");
  wheel(-100);
  near(lab.view.lzt, 0.18, 1e-3, "and back");
  wheel(-50, true);
  near(lab.view.lzt, 0.18 + 0.6, 1e-3, "a trackpad pinch apart (ctrl + wheel up) moves in, faster");
  wheel(100000);
  near(lab.view.lzt, 0.95, 1e-9, "the nearest it goes");
  wheel(-100000);
  near(lab.view.lzt, -0.85, 1e-9, "the farthest");
  lab.home();
  await virtualClock((tick) => {
    ptr("pointerdown", 300, 300, 11);
    ptr("pointerdown", 400, 300, 12);
    ptr("pointermove", 250, 300, 11);
    ptr("pointermove", 450, 300, 12); // the fingers go from 100 to 200 px apart
    near(lab.view.lzt, Math.log(2), 0.02, "a pinch that doubles the distance");
    ptr("pointerup", 250, 300, 11);
    ptr("pointerup", 450, 300, 12);
    tick(2000);
    near(lab.view.lz, lab.view.lzt, 0.01, "the shown dolly has caught up");
  });
});

test("the keys: arrows turn by 15°, + and − move, R goes home", async () => {
  await lab.useModel(MODELS.cd);
  lab.home();
  lab.view.q = lab.view.qt.slice();
  const q0 = lab.view.qt.slice();
  key("ArrowRight");
  near(deg(qangle(q0, lab.view.qt)), 15, 0.1, "one arrow press");
  key("+");
  near(lab.view.lzt, 0.2, 1e-9);
  key("r");
  near(deg(qangle(lab.view.qt, homeQ(26, -20))), 0, 1e-4, "the home pose");
  near(lab.view.lzt, 0, 1e-9, "and the home distance");
});

test("pause stops the clock, the spin and the waves, but the model can still be turned", async () => {
  await lab.useModel(MODELS.cd);
  lab.pose(0, 0);
  lab.step(16);
  lab.pause(true);
  const c0 = lab.info().clock;
  lab.step(500);
  near(lab.info().clock, c0, 1e-9, "the clock");
  lab.turn(80, 0);
  const q = lab.view.q.slice();
  lab.step(300);
  ok(deg(qangle(q, lab.view.q)) > 0.5, "the pose still follows a turn");
  lab.pause(false);
  lab.step(500);
  near(lab.info().clock, c0 + 0.5, 1e-6, "and runs again");
});

// ================================================================== models and knobs
test("each model brings its own knobs and takes them away again", async () => {
  await lab.useModel(MODELS.cd);
  const cd = { spin: lab.P.spin, dens: lab.P.dens, rx: lab.P.rx, thick: lab.P.thick };
  near(cd.spin, 40, 0, "the CD spins");
  near(cd.dens, 1.2, 0);
  await lab.useModel(MODELS.text);
  near(lab.P.spin, 0, 0, "the text does not");
  near(lab.P.dens, 0.72, 0, "the hero's letter density");
  near(lab.P.rx, 0, 0, "it faces you");
  await lab.useModel(MODELS.cd);
  ok(lab.P.spin === cd.spin && lab.P.dens === cd.dens && lab.P.rx === cd.rx && lab.P.thick === cd.thick, "back to the CD's");
  ok(lab.info().model === "cd", "the model is reported");
  between(deg(qangle(lab.view.q, homeQ(26, -20))), 0, 1e-4, "and its home pose is taken at once");
});

test("a query parameter beats a model's default, and the engine's", async () => {
  const c2 = document.createElement("canvas");
  Object.assign(c2.style, { position: "fixed", left: "-9999px", width: "400px", height: "300px" });
  document.body.appendChild(c2);
  const lab2 = createEngine({ canvas: c2, query: new URLSearchParams("dpr=1&dens=0.5&spin=7&thick=0.05") });
  await lab2.useModel(MODELS.cd);
  ok(lab2.P.dens === 0.5 && lab2.P.spin === 7 && lab2.P.thick === 0.05, "on the CD");
  ok(lab2.P.rx === 26, "the rest are the engine's");
  await lab2.useModel(MODELS.text);
  ok(lab2.P.dens === 0.5 && lab2.P.spin === 7, "on the text, which would say 0.72 and 0");
  ok(lab2.P.rx === 0, "but its own rx stands");
  c2.remove();
});

test("a picture becomes a card of its own proportions; a sketch animates; a bad URL leaves things as they were", async () => {
  await lab.load(dataURL(640, 360, (x, w, h) => { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); }));
  let i = lab.info();
  ok(i.model === "picture" && !i.plate.disc, "a card");
  near(i.plate.ay / i.plate.ax, 360 / 640, 1e-6, "16:9");
  near(lab.P.spin, 0, 0, "it stands still");

  await lab.load("sketch:rings");
  Object.assign(lab.P, { field: 0, build: 0 }); // (load() puts the model's knobs back: these go after it)
  lab.step(2000);
  const a = shot();
  lab.step(600);
  const b = shot();
  let diff = 0;
  for (let k = 0; k < W * H; k++) if (lit(a, k % W, (k / W) | 0) !== lit(b, k % W, (k / W) | 0)) diff++;
  ok(diff > 200, `the rings moved (${diff} pixels differ)`);

  const before = lab.info().source;
  const seen = await expectError(() => lab.load("/lab/media/nope-404.png"));
  ok(seen.length === 1 && /could not load image/.test(seen[0]), `a clear error (${seen})`);
  ok(lab.info().source === before, "the source stays");
  const seen2 = await expectError(() => lab.load("sketch:nope"));
  ok(seen2.length === 1 && /no sketch called nope/.test(seen2[0]), `and for a sketch (${seen2})`);
});

test("a picture's dots land in over the build, and it ends whole", async () => {
  await lab.load(dataURL(256, 256, (x, w, h) => { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); }));
  Object.assign(lab.P, { field: 0, build: 2.8 });
  lab.rebuild();
  lab.step(0);
  const shares = [];
  let t = 0;
  for (const to of [0.05, 0.4, 1, 2, 3.2]) { lab.step((to - t) * 1000); t = to; shares.push(share(shot())); }
  const final = shares.at(-1);
  between(final, 0.1, 0.5, "the finished card");
  for (let k = 1; k < shares.length; k++) ok(shares[k] >= shares[k - 1] - 0.005, `it never loses dots: ${shares.map((s) => s.toFixed(3))}`);
  ok(shares[0] < 0.3 * final, "it starts nearly empty");
  ok(shares[2] > 0.15 * final && shares[2] < 0.85 * final, "and is part-way in the middle");
});

// ================================================================== pixel text
const TEXT_SOLID = { field: 0, lattice: 0, dens: 3 };
async function setText(params, arg) {
  await lab.useModel({ ...MODELS.text, params: { ...MODELS.text.params, ...params } }, arg);
}

test("pixel text: Jersey 25 loads, its grid fits the canvas exactly, and the two words are all there", async () => {
  await setText({});
  const s = lab.source;
  ok(s.pixel && s.raw && s.plate.pixelGrid, "a pixel source");
  ok(s.info.words === 2, `two words (${s.info.words})`);
  between(s.info.pixels, 3000, 3300, "pixels lit (3162 at the time of writing)");
  ok(s.info.edgesOnGrid[0] === 1 && s.info.edgesOnGrid[1] === 1, `every edge of the 8× render is on the font's pixel grid (${s.info.edgesOnGrid})`);
  ok(s.info.grid[0] === 164 && s.info.grid[1] === 69, `the grid is ${s.info.grid}`);
  const words = [0, 0];
  for (const w of s.wordOf) if (w !== 255) words[w]++;
  ok(words[0] > 500 && words[1] > 1500, `each word has pixels (${words})`);
  ok(words[0] + words[1] === s.info.pixels, "and every lit pixel belongs to one");
});

test("pixel text: the bitmap is the text: inside a plain 41 px render of the same words (which is fatter at the edges), and most of it", async () => {
  await setText({});
  const s = lab.source;
  const [gw, gh] = s.info.grid;
  const c = document.createElement("canvas");
  c.width = gw;
  c.height = gh;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.font = '41px "Jersey 25"';
  x.fillStyle = "#fff";
  x.textBaseline = "alphabetic";
  for (const w of s.words) x.fillText(w.text, w.x, w.base);
  const d = x.getImageData(0, 0, gw, gh).data;
  let both = 0, either = 0, bitmap = 0;
  for (let p = 0; p < gw * gh; p++) {
    const a = d[p * 4 + 3] >= 128;
    const b = s.wordOf[p] !== 255;
    if (a && b) both++;
    if (a || b) either++;
    if (b) bitmap++;
  }
  // (the plain render is thicker: the canvas fringes strokes, 3533 pixels against the bitmap's 3162. So the bitmap must lie inside it,
  // and fill most of it; one pixel of shift, with strokes 5 px wide, would put a fifth of the bitmap outside)
  ok(both / bitmap > 0.97, `the bitmap lies inside the plain render: ${(both / bitmap).toFixed(3)} of its pixels do`);
  ok(both / (both + (either - bitmap)) > 0.85, `and fills most of it: ${(both / (both + (either - bitmap))).toFixed(3)}`);
  between(bitmap / (d.length / 4), 0.2, 0.5, "and it is mostly ink-free, as text is");
  const left = Math.min(...s.words.map((w) => w.x));
  let firstCol = gw;
  for (let p = 0; p < gw * gh; p++) if (s.wordOf[p] !== 255) firstCol = Math.min(firstCol, p % gw);
  between(firstCol, left - 1, left + 8, "the leftmost pixel is where the leftmost word was set");
});

test("pixel text: other text lays out, left-aligned and over more lines", async () => {
  await setText({}, { text: "a|bb ccc|dddd" });
  ok(lab.source.info.words === 4, `4 words (${lab.source.info.words})`);
  ok(lab.source.info.grid[1] > 69 + 30, `three lines are taller than two (${lab.source.info.grid})`);
  const expected = await expectError(() => setText({}, { text: "   " }));
  ok(expected.length === 1 && /nothing to set/.test(expected[0]), "empty text is an error, not a crash");
});

test("pixel text: a font pixel is a whole number of cells and the sheet's edges fall on cell boundaries", async () => {
  await setText({});
  const i = lab.info();
  const { px, off } = i.layout;
  ok(Number.isInteger(px) && px >= 1, `px = ${px}`);
  const [gw, gh] = lab.source.info.grid;
  for (const [edge, o] of [[i.cells[0] / 2 - (gw * px) / 2, off[0]], [i.cells[1] / 2 - (gh * px) / 2, off[1]]]) near((edge + o) % 1, 0, 1e-9, "an edge on a whole cell");
  const biggest = Math.min(Math.floor((lab.P.size * i.cells[0]) / gw), Math.floor((lab.P.size * i.cells[1]) / gh));
  ok(px === Math.max(1, biggest), `the biggest that fits (${px} of ${biggest})`);
  await setText({ px: 3 });
  ok(lab.info().layout.px === 3, "?px= is taken");
});

test("pixel text: on screen every lit run is a whole number of font pixels, starting on the pixel grid, for texts that need the half-cell shift too", async () => {
  let runs = 0;
  let shifted = 0;
  let cases = 0;
  for (const text of ["feeling|nostalgic?", "hello", "pixels", "a", "word by word", "xyz?", "oi"]) {
    for (const px of [1, 2, 3]) {
      await setText({ ...TEXT_SOLID, px }, { text });
      const i = lab.info();
      const [gw, gh] = lab.source.info.grid;
      const unit = px * CELL; // one font pixel, in device px
      if (gw * unit > W - 8 || gh * unit > H - 8) continue; // (does not fit this canvas)
      cases++;
      if (Math.abs(i.layout.off[0]) > 0.1 || Math.abs(i.layout.off[1]) > 0.1) shifted++;
      lab.step(6000); // the whole text, flashes gone
      const img = shot();
      const left = (i.cells[0] / 2 - (gw * px) / 2 + i.layout.off[0]) * CELL; // the sheet's edges, in device px
      const top = H - (i.cells[1] / 2 + (gh * px) / 2 + i.layout.off[1]) * CELL;
      const where = `"${text}" at ${px} cell${px > 1 ? "s" : ""} per pixel`;
      for (let y = Math.ceil(top) + 1; y < top + gh * unit; y += unit) { // one row through each font pixel row
        let start = -1;
        for (let x = 0; x <= W; x++) {
          const l = x < W && lit(img, x, y);
          if (l && start < 0) start = x;
          if (!l && start >= 0) {
            runs++;
            ok((x - start) % unit === 0, `${where}, row ${y}: a run of ${x - start} px is not a multiple of ${unit}`);
            ok((start - left) % unit === 0, `${where}, row ${y}: a run starts off the grid (at ${start}, the sheet's edge is at ${left})`);
            start = -1;
          }
        }
      }
      const e = extent(img);
      ok(e.w <= gw * unit && e.h <= gh * unit, `${where}: nothing outside the sheet`);
    }
  }
  ok(cases >= 8, `enough cases fit (${cases})`);
  ok(shifted >= 2, `and some of them needed the half-cell shift (${shifted}), or this would prove nothing about it`);
  ok(runs > 300, `enough runs were checked (${runs})`);
});

test("pixel text lands word by word: a word is complete before the next begins, and the pixels of a word land at different moments", async () => {
  await setText({});
  const s = lab.source;
  const d = s.raw.data;
  lab.rebuild();
  lab.step(0);
  const idx = [[], []];
  for (let p = 0; p < s.wordOf.length; p++) if (s.wordOf[p] !== 255) idx[s.wordOf[p]].push(p * 4);
  const filled = (w) => idx[w].filter((i) => d[i + 1] === 255).length / idx[w].length;
  const started = (w) => idx[w].filter((i) => d[i + 1] > 0).length / idx[w].length;
  ok(started(0) === 0 && started(1) === 0, "nothing at t = 0");
  let t = 0;
  let prev = [0, 0];
  const log = [];
  for (let k = 1; k <= 80; k++) {
    lab.step(50);
    t += 0.05;
    const f = [filled(0), filled(1)];
    ok(f[0] >= prev[0] && f[1] >= prev[1], `a word un-filled at ${t.toFixed(2)} s`);
    if (started(1) > 0) ok(f[0] === 1, `word 1 began at ${t.toFixed(2)} s while word 0 was ${(f[0] * 100).toFixed(0)} % full`);
    prev = f;
    if (k % 10 === 0) log.push(`${t.toFixed(1)}s: ${(f[0] * 100) | 0}%/${(f[1] * 100) | 0}%`);
    if (Math.abs(t - 0.5) < 1e-9) between(f[0], 0.01, 0.6, "word 0 is part-way at 0.5 s");
    if (Math.abs(t - 1.0) < 1e-9) between(f[0], 0.4, 1, "…and mostly done at 1 s");
    if (Math.abs(t - 1.2) < 1e-9) ok(started(1) === 0, "word 1 has not begun at 1.2 s (it starts at 1.4)");
  }
  ok(prev[0] === 1 && prev[1] === 1, `all filled by ${t.toFixed(1)} s (${log.join("  ")})`);
  ok(idx[0].every((i) => d[i + 2] < 12), "and the flashes have died");
});

test("pixel text: the timing knobs are live and loop repeats it", async () => {
  await setText({}, undefined);
  const s = lab.source;
  s.opts.word = 0.4;
  s.opts.gap = 0.1;
  s.opts.fill = 0.1;
  lab.rebuild();
  lab.step(0);
  lab.step(1200); // 0.4 + 0.1 + 0.4 + 0.1 = 1.0 s of animation
  ok([...s.wordOf].every((w, p) => w === 255 || s.raw.data[p * 4 + 1] === 255), "a faster text is complete at 1.2 s");
  s.opts.loop = 2;
  lab.rebuild();
  lab.step(0);
  const total = 0.4 * 2 + 0.1 + 0.1 + 0.6; // the duration plus the rest: loops every total + 2 s
  lab.step((total + 2 + 0.05) * 1000);
  ok([...s.wordOf].some((w, p) => w !== 255 && s.raw.data[p * 4 + 1] < 255), "after the rest it starts over");
});

test("pixel text: order=ltr fills a word from the left", async () => {
  await setText({}, { order: "ltr" });
  const s = lab.source;
  lab.rebuild();
  lab.step(0);
  lab.step(450); // part-way through word 0
  const w = s.raw.w;
  let n = [0, 0], sum = [0, 0];
  for (let p = 0; p < s.wordOf.length; p++) {
    if (s.wordOf[p] !== 0) continue;
    const full = s.raw.data[p * 4 + 1] > 0 ? 0 : 1; // landed, or not yet
    n[full]++;
    sum[full] += p % w;
  }
  ok(n[0] > 50 && n[1] > 50, `some landed, some not (${n})`);
  ok(sum[0] / n[0] < sum[1] / n[1] - 8, `the landed ones are the left ones: mean x ${(sum[0] / n[0]).toFixed(0)} against ${(sum[1] / n[1]).toFixed(0)}`);
  await setText({}, { order: "random" });
  lab.rebuild();
  lab.step(0);
  lab.step(450);
  n = [0, 0]; sum = [0, 0];
  for (let p = 0; p < lab.source.wordOf.length; p++) {
    if (lab.source.wordOf[p] !== 0) continue;
    const k = lab.source.raw.data[p * 4 + 1] > 0 ? 0 : 1;
    n[k]++;
    sum[k] += p % w;
  }
  ok(Math.abs(sum[0] / n[0] - sum[1] / n[1]) < 8, "at random they are not (the mean x of landed and unlanded agree)");
});

test("pixel text keeps working turned in 3D, and the wave crosses it", async () => {
  await setText({ field: 0 });
  lab.step(6000);
  const flat = share(shot());
  lab.pose(20, -35);
  lab.step(16);
  const turned = share(shot());
  between(turned / flat, 0.4, 1.1, "a turned sheet still prints (it foreshortens)");
  lab.pose(0, 0);
  lab.step(16);
  lab.wave();
  lab.step(260);
  ok(share(shot()) < 0.92 * flat, `the cancelling ring takes dots out of the text (${share(shot()).toFixed(4)} of ${flat.toFixed(4)})`);
});

// ================================================================== housekeeping
test("the engine's API: shot() is a PNG, info() reports the sizes, nothing threw", async () => {
  await lab.useModel(MODELS.cd);
  ok(lab.shot().startsWith("data:image/png;base64,"), "a PNG");
  const i = lab.info();
  ok(i.cell === CELL && i.cells[0] === W / CELL && i.cells[1] === H / CELL && i.dev[0] === W && i.dev[1] === H, `sizes ${JSON.stringify(i.cells)}`);
  ok(errors.length === 0, `no errors outside the ones provoked: ${errors.join(" | ")}`);
});

// ------------------------------------------------------------------ run
async function run() {
  const results = [];
  for (const t of tests) {
    const t0 = performance.now();
    try {
      await t.fn();
      results.push({ name: t.name, ok: true, ms: performance.now() - t0 });
    } catch (e) {
      results.push({ name: t.name, ok: false, error: e.message, ms: performance.now() - t0 });
    }
    out.textContent = "";
    for (const r of results) {
      const line = document.createElement("div");
      line.className = r.ok ? "ok" : "fail";
      line.textContent = `${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.error}`}`;
      out.appendChild(line);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const sum = document.createElement("div");
  sum.className = "sum";
  sum.textContent = `\n${passed}/${results.length} passed`;
  out.appendChild(sum);
  document.title = `${passed === results.length ? "PASS" : "FAIL"} ${passed}/${results.length} — lab tests`;
  window.__tests = { passed, total: results.length, failed: results.filter((r) => !r.ok), results };
  document.body.dataset.done = "1";
}
run();
