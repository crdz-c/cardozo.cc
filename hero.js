// cardozo.cc hero — one canvas of dots. The CRDZC wordmark is drawn into a single dithered dot field. Each letter
// is a link, and under each letter lies the brand mark of its link: the pointer opens the wordmark like a curtain
// and reveals the marks beneath it; left alone, the letters turn into their marks on their own and every 9 s it all
// converges back into CRDZC. A letter's own change melts one shape into the other.
// The pointer itself is drawn as a ring of dots around a black hole, inside a soft gradient of dots (the system cursor
// is hidden); a click on the background sends two pulses of one long wave across the screen that, as they pass, cancel
// the dots' energy for a moment and show what lies behind the wordmark; there is a light theme (true black & white),
// switched from the top. Everything that appears does so the way the loading does, only faster: every dot lights at
// its own moment, quick first, the last ones late, easing out. Loading is the wordmark accumulating dot by dot, at
// random, in bursts. No dependencies. Everything degrades: no JS → the SVG letters as links; no WebGL → the same SVG,
// cross-dissolving between letter and mark; prefers-reduced-motion → one still frame (still in dots).

import { distanceTransform, roundCorners, blueNoise } from "./raster.js";
import { BRANDS } from "./brands.js";
import { pair, GLSL_WALK, HOP_RATE, TRAIL, SPAN, PAUSE_S, FLASH_S } from "./walk.js";

const html = document.documentElement;
const hero = document.getElementById("hero");
const canvas = hero.querySelector(".scene");
const logoSvg = hero.querySelector(".logo svg");

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const query = new URLSearchParams(location.search);

// debug only (?debug&seed=7&freeze=6): the page is the same every load, so a change can be compared with the home pixel for
// pixel. `seed` makes Math.random repeatable (the blue-noise map, each letter's mirrored identity, the cycle's plan); `freeze`
// stops the clock at that many seconds, and the stand-alone choreography (its morphs and its pulse run on real time) with it.
// Nothing here runs without ?debug.
if (query.has("debug") && query.has("seed")) {
  let a = Number(query.get("seed")) >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FREEZE = query.has("debug") && query.has("freeze") ? Number(query.get("freeze")) : null;
// debug only (?debug&demo): a throw-away page and the arrow to it, to see the walk and the page machinery while there is no real
// page. It is not content and never ships in the HTML.
if (query.has("debug") && query.has("demo")) {
  hero.insertAdjacentHTML(
    "beforeend",
    `<a class="go" href="#demo" aria-label="Open the demo"><svg viewBox="0 0 22 22" aria-hidden="true"><path d="M3 11h15M12 4.5L18.5 11 12 17.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
     <section class="page" data-page="demo" id="demo" aria-label="Demo"><h2 data-t>Demo</h2><a href="#" data-t data-back aria-label="Back to the home">Back</a></section>`
  );
}

// (the two palettes live in the shader: true black + paper for dark, true white + true black for light)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ knobs (interaction, JS side)
// Springs: angular frequency ω (1/s) and damping ratio ζ (1 = critically damped).
const POINTER_R = 32; // CSS px: radius of the pointer's push on the field (its gradient is GRAD_R × this)
const NUCLEUS_R = 5; // CSS px: the nucleus (a ring of dots round a black hole), drawn exactly on the pointer's hotspot
const POINTER_SPRING = [30, 1]; // the gradient's centre follows the nucleus on this spring…
const POINTER_LAG = 0.3; // …but never trails it by more than this, × POINTER_R
const AFTERGLOW = 2.8; // s: decay time of the field's stirred-up energy
const MAX_SPEED = 2400; // CSS px/s: cap on the speed the field's deflection and wake respond to
const CURTAIN_R = 0.85; // × wordmark height: radius of the reveal around the pointer
const CURTAIN_SPRING = [16, 1]; // the reveal follows the pointer on this spring (fluid, a little behind)
const CURTAIN_OPEN = 10; // 1/s: how fast the reveal opens…
const CURTAIN_CLOSE = 3; // …and closes again (a soft delay as the letters re-form)
const REPEL_OPEN = [7, 0.8]; // the repel (oil on water) opens on this spring (ω, ζ: a touch of overshoot)…
const REPEL_CLOSE = [3.2, 1]; // …and flows back on this slower one
const IDLE_MS = 3000; // ms without pointer input before the stand-alone choreography resumes
const MORPH_MS = [900, 1300]; // ms per change (letter ⇄ mark, eased out), scaled down for a partial one
// the stand-alone cycle (ms from the cycle's start): hold → individual morphs → convergence → hold
const CYCLE_MS = 9000;
const SOLO_AT = [700, 3600]; // each letter turns into its mark at a random moment in here…
const SOLO_BACK = 0.5; // …and with this chance turns back on its own…
const SOLO_BACK_AFTER = [1700, 2600]; // …this long after
const CONVERGE_AT = 6200; // everything still showing a mark morphs back, staggered over…
const CONVERGE_STAGGER = 500; // …this (so it is all letters again by ~8.4 s)
const PULSE_AT = 6000; // the convergence pulse (letters brighten, the field thins and gathers)…
const PULSE_MS = 3600; // …lasts this long (peaks at ~7.8 s, fades through the hold into the next cycle)
const WAVE_LIFE = 3.2; // s: a wave's whole life (it passes the farthest corner, then fades)
const WAVE_PULSES = 2; // a click sends this many pulses…
const WAVE_PULSE_GAP = 0.2; // …this many seconds apart (each a full ring; the next one runs through the revealed marks)…
const WAVE_PULSE_DECAY = 0.15; // …each this much weaker than the one before
const MAX_WAVES = 8; // (4 clicks' worth overlap)
// Loading: how fast the dots land over the build (Lucas's sketch), as segments on the normalised timeline:
// [from t, to t, from v, to v, shape], v as a share of the top rate. Shapes: 0 linear, k > 0 a decay that is fast
// first and flattens (1 − e^(−k·u)), -1 an abrupt jump (smoothstep, a few frames). The fill is the integral of v,
// normalised so the wordmark is complete exactly at the end.
const BUILD_RATE = [
  [0, 0.207, 0, 1, 0], // burst 1: a linear ramp to the top rate at ~21 %…
  [0.207, 0.32, 1, 0.19, 3], // …and a crash to ~19 % by 32 %
  [0.32, 0.387, 0.19, 0.47, 0], // a smaller bump to ~47 % at ~39 %…
  [0.387, 0.563, 0.47, 0.22, 2.5], // …decaying to ~22 % by 56 %
  [0.563, 0.573, 0.22, 0.95, -1], // burst 2: an abrupt jump to ~95 %…
  [0.573, 0.766, 0.95, 0.33, 2.5], // …decaying to ~33 % by 77 %
  [0.766, 0.777, 0.33, 0.95, -1], // burst 3: another abrupt jump to ~95 %…
  [0.777, 0.992, 0.95, 0.51, 0.6], // …and a slow, nearly linear decay to ~51 %
  [0.992, 1, 0.51, 0.51, 0], // the last dots land and it stops
];
// The theme switch (top right): its icon lights in once the build is over; a change sweeps out from it, softly.
const ICON_R = 11; // CSS px: radius of the theme switch's icon (a moon in the dark theme, a sun in the light one)
const ICON_IN_MS = 700;
const THEME_MS = 1500; // the theme change runs this long, easing out (one smooth deceleration: no bursts, which stutter when squeezed)
const THEME_COLOR = { dark: "#000000", light: "#ffffff" };
// Touch (there is no hover, so the gestures differ; the layout does not): a tap on the wordmark reveals all the marks and
// they stay (a tap on a revealed mark opens its link; a tap elsewhere hides them, or sends the wave if they are hidden);
// press and hold, or drag, brings the curtain to the finger, bigger and a little above it, and never opens a link.
const HOLD_MS = 250; // a press longer than this is a hold, not a tap
const TOUCH_SLOP = 10; // CSS px: moving further than this turns a press into a drag
const REVEAL_HIDE_MS = 8000; // revealed marks hide by themselves after this long untouched
const TOUCH_CURTAIN = 1.4; // the curtain's radius on touch, × the mouse's (a fingertip would cover the mouse-sized one; the phone's wordmark is bigger now)…
const TOUCH_LIFT = 24; // …and it sits this many CSS px above the finger
// Frame time: the dots get one device px coarser (twice at most) if the frames stay slower than this on average.
const ADAPT_MS = 26;
const ADAPT_MAX = 2;
const BUILD_S = 8; // s: the whole build on a first visit (or ?boot)
const BUILD_QUICK = 2.8; // s: the whole build for a returning visitor in this session
const CURTAIN_FROM = 0.5; // the curtain works once the build is this far along

// ------------------------------------------------------------------ shared state
const state = {
  intro: reduce ? 1 : 0, // 0 → 1 : the wordmark accumulates
  time: reduce ? 6 : 0,
  logoCss: [0, 0, 1, 1], // left, top, w, h of the wordmark (client px)
  // the pointer (hero CSS px): t = hotspot, x/y = the gradient's centre on its spring, str = presence
  e: { x: -1e4, y: -1e4, vx: 0, vy: 0, tx: -1e4, ty: -1e4, on: false, str: 0, sv: 0 },
  link: false, // the pointer is over a letter-link
  linkAmt: 0,
  lastInput: -Infinity, // performance.now() of the last pointer input
  // the curtain: its centre (hero CSS px, on a spring) and how open it is (0..1)
  cur: { x: -1e4, y: -1e4, vx: 0, vy: 0, amt: 0, rep: 0, rv: 0, tk: 0 }, // tk: 0 mouse … 1 touch (size and lift)
  pulse: 0, // convergence pulse 0..1
  energy: 0, // stirred-up energy of the field (0..1), decays over AFTERGLOW
  stir: [0, 0], // where it was last stirred, hero CSS px
  focusRect: null,
  focusAmt: 0,
  waves: [], // { x, y, t0 } in hero CSS px, seconds
  touchMode: false, // the latest pointer was a finger (the curtain grows and lifts, the mouse's ring and gradient go)
  nuc: 0, // the pointer ring's presence 0..1 (its dots light in at random, see the shader)
  tog: { amt: 0, from: 0, to: 0, t0: 0, dur: 0, hot: 0, hover: false, focus: false }, // the theme switch's icon: how lit, how hovered
  go: { amt: 0, from: 0, to: 0, t0: 0, dur: 0, hot: 0, hover: false, focus: false }, // the arrow to the next page (or back): the same
  focusUI: null, // the on-screen button (the theme switch) with keyboard focus: the compose pass underlines it
  focusUIAmt: 0,
};

// ------------------------------------------------------------------ letters: links with a mark beneath
// Each letter is a link (an SVG <a> in index.html). Beneath it lies the brand mark of its link. A letter's state
// is one number, `amt`: 0 shows the letter, 1 the mark; it moves between them by a morph (eased over MORPH_MS) and
// in between, the shader melts one shape into the other (see FIELD). The letters keep a random
// orientation (mirrored or not, on each axis) as a static identity for the visit; marks are always upright.
const LETTERS = 5;
const LETTER_EDGES = [-1, 18.55 / 90, 36.15 / 90, 54.75 / 90, 71.15 / 90, 2]; // gap midpoints, in u
const LETTER_CENTERS = [8.9 / 90, 27.35 / 90, 45.45 / 90, 62.95 / 90, 80.8 / 90];
const links = [...logoSvg.querySelectorAll(".ln")];
const letterGroups = links.map((a) => a.querySelector(".lt"));
// which brand mark lies beneath each letter, read from its link (reorder the links in index.html to remap)
const brandOf = (href) =>
  href.startsWith("mailto:") ? "email"
  : /linkedin\./.test(href) ? "linkedin"
  : /github\./.test(href) ? "github"
  : /medium\./.test(href) ? "medium"
  : /dribbble\./.test(href) ? "dribbble"
  : "email";
const LETTER_BRANDS = links.map((a) => brandOf(a.getAttribute("href")));

const letterUniform = new Float32Array(LETTERS * 4); // per letter: amt, mirror x, mirror y, 0
const letters = Array.from({ length: LETTERS }, () => ({
  mx: Math.random() < 0.5 ? 1 : -1, // orientation identity: random on every load, never animated
  my: Math.random() < 0.5 ? 1 : -1,
  amt: 0, // 0 letter … 1 mark
  from: 0,
  to: 0,
  t0: 0,
  dur: 0,
  events: [], // this cycle's planned morphs: { at (ms into the cycle), to }
}));
let revealAll = false; // touch: all the marks are shown and stay
const held = new Set(); // letters with keyboard focus (they show their mark); the choreography leaves them alone
const hovered = new Set(); // no-WebGL only: letters under the pointer (whole-letter reveal)
const pinned = (i) => held.has(i) || hovered.has(i) || revealAll;
let cycleStart = null; // performance.now() when the running stand-alone cycle began; null while paused
let pulseT0 = -Infinity;
let ready = false; // the build is over: the choreography may run

function amtAt(L, now) {
  if (!L.dur) return L.to;
  const t = clamp01((now - L.t0) / L.dur);
  return L.from + (L.to - L.from) * easeOutCubic(t); // fast first, a soft landing
}

// start a morph of letter i toward `to` (0 letter, 1 mark) from wherever it is now
function morphTo(i, to, now) {
  const L = letters[i];
  if (L.to === to) return;
  const from = amtAt(L, now);
  L.from = from;
  L.to = to;
  L.t0 = now;
  L.dur = reduce ? 0 : rand(...MORPH_MS) * Math.max(0.35, Math.abs(to - from));
}

function planCycle() {
  letters.forEach((L) => {
    const at = rand(...SOLO_AT);
    L.events = [{ at, to: 1 }];
    if (Math.random() < SOLO_BACK) L.events.push({ at: at + rand(...SOLO_BACK_AFTER), to: 0 });
    L.events.push({ at: CONVERGE_AT + rand(0, CONVERGE_STAGGER), to: 0 });
  });
}

// pointer input pauses the choreography: letters showing their marks go back to normal (the curtain shows the
// marks where the pointer is); it starts again, from its hold, IDLE_MS after the last input
function pauseCycle(now) {
  if (cycleStart === null) return;
  cycleStart = null;
  letters.forEach((L, i) => !pinned(i) && morphTo(i, 0, now));
}

function updateLetters(now) {
  const idle = now - state.lastInput > IDLE_MS;
  const atHome = shown === "home" && !scene?.walking(); // (the choreography is the wordmark's: it waits on a page and while walking)
  if (!atHome && cycleStart !== null) pauseCycle(now);
  if (ready && !reduce && FREEZE === null && atHome) {
    if (!idle) pauseCycle(now);
    else if (cycleStart === null && !revealAll) {
      cycleStart = now;
      planCycle();
    }
    if (cycleStart !== null) {
      while (now - cycleStart >= CYCLE_MS) {
        cycleStart += CYCLE_MS;
        planCycle();
      }
      const phase = now - cycleStart;
      if (phase >= PULSE_AT && pulseT0 < cycleStart) pulseT0 = cycleStart + PULSE_AT;
      letters.forEach((L, i) => {
        while (L.events.length && L.events[0].at <= phase) {
          const ev = L.events.shift();
          if (!pinned(i)) morphTo(i, ev.to, now);
        }
      });
    }
  }
  const u = (now - pulseT0) / PULSE_MS;
  state.pulse = u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0;
  // Which shape of each link answers to a pointer: the letter while it shows a letter, the mark while it shows its mark, and
  // both while the curtain is open over it (the mark is then revealed round the pointer). Never the empty column round them.
  const cu = state.cur;
  const hb = hero.getBoundingClientRect();
  const [lgx, lgy, lgw, lgh] = state.logoCss;
  const curR = CURTAIN_R * lgh * (1 + (TOUCH_CURTAIN - 1) * cu.tk) * 0.9;
  letters.forEach((L, i) => {
    L.amt = amtAt(L, now);
    letterUniform.set([L.amt, L.mx, L.my, 0], i * 4);
    const covered = cu.amt > 0.4 && Math.hypot(lgx - hb.left + lgw * LETTER_CENTERS[i] - cu.x, lgy - hb.top + lgh / 2 - cu.y) < curR;
    const wantLt = L.amt < 0.5;
    const wantMk = L.amt >= 0.5 || covered;
    if (L.hitLt !== wantLt) links[i].classList.toggle("hit-lt", (L.hitLt = wantLt));
    if (L.hitMk !== wantMk) links[i].classList.toggle("hit-mk", (L.hitMk = wantMk));
  });
  if (!scene) dissolveSvg();
}

// no-WebGL fallback: the SVG cross-dissolves between each letter and its mark (opacity only, no flip)
let brandGroups = [];
function makeBrandGroups() {
  brandGroups = links.map((a, i) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "bf");
    g.setAttribute("aria-hidden", "true");
    g.style.opacity = "0";
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const b = BRANDS[LETTER_BRANDS[i]];
    const { x, y, s } = brandFit[i];
    p.setAttribute("d", b.d);
    if (b.evenodd) p.setAttribute("fill-rule", "evenodd");
    // the placement goes on its own <g>: `.logo path` sets a transform box/origin meant for the letters
    const place = document.createElementNS("http://www.w3.org/2000/svg", "g");
    place.setAttribute("transform", `translate(${x} ${y}) scale(${s})`);
    place.appendChild(p);
    g.appendChild(place);
    // the mark's own box (centred on its letter): where a tap on the mark counts. It is the mark, not its column: the links
    // answer to the letter or the icon itself, nothing round them
    const box = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    box.setAttribute("class", "mk-hit");
    box.setAttribute("x", LETTER_CENTERS[i] * VBW - brandFit[i].w / 2);
    box.setAttribute("y", VBH / 2 - brandFit[i].h / 2);
    box.setAttribute("width", brandFit[i].w);
    box.setAttribute("height", brandFit[i].h);
    box.setAttribute("fill", "transparent");
    g.appendChild(box);
    a.appendChild(g);
    return g;
  });
}
function dissolveSvg() {
  letters.forEach((L, i) => {
    letterGroups[i].style.transform = `scale(${L.mx}, ${L.my})`;
    letterGroups[i].style.opacity = String(1 - L.amt);
    brandGroups[i].style.opacity = String(L.amt);
  });
}

// The wordmark's place in the scene (the wordmark is always at the hero's centre).
function measureLogo() {
  const r = logoSvg.getBoundingClientRect();
  const h = hero.getBoundingClientRect();
  state.logoCss = [h.left + h.width / 2 - r.width / 2, h.top + h.height / 2 - r.height / 2, r.width, r.height];
}

// pointer / keyboard on a letter-link. A click (or tap) always opens the link, whatever the letter shows.
// Keyboard focus shows the letter's mark (and the dotted focus underline) until focus leaves.
links.forEach((a, i) => {
  a.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    state.link = true;
    if (!scene) {
      hovered.add(i);
      morphTo(i, 1, performance.now());
    }
  });
  a.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    state.link = false;
    if (!scene && !held.has(i)) {
      hovered.delete(i);
      morphTo(i, 0, performance.now());
    }
  });
  a.addEventListener("focus", () => {
    if (!a.matches(":focus-visible")) return;
    held.add(i);
    morphTo(i, 1, performance.now());
    state.focusRect = a.querySelector(".hit").getBoundingClientRect();
    if (reduce) {
      state.focusAmt = 1;
      updateLetters(performance.now());
      scene?.draw();
    }
  });
  a.addEventListener("blur", () => {
    if (!held.delete(i)) return;
    if (!hovered.has(i)) morphTo(i, 0, performance.now());
    state.focusRect = null;
    if (reduce) {
      state.focusAmt = 0;
      updateLetters(performance.now());
      scene?.draw();
    }
  });
});

// ------------------------------------------------------------------ the dots' way of appearing
// Everything that comes into the interface lights the way the loading does, only faster: a number runs 0 → 1 with
// an ease-out (quick first, a soft landing), and in the shader every dot has its own moment (its blue-noise rank) at
// which that number reaches it, so most light almost at once and a few come late.
function tweenTo(o, to, ms, now) {
  o.from = o.amt;
  o.to = to;
  o.t0 = now;
  o.dur = reduce ? 0 : ms;
  if (!o.dur) o.amt = to;
}
function stepTween(o, now) {
  if (!o.dur) return;
  const t = clamp01((now - o.t0) / o.dur);
  o.amt = o.from + (o.to - o.from) * easeOutCubic(t);
  if (t >= 1) {
    o.amt = o.to;
    o.dur = 0;
  }
}

const themeBtn = hero.querySelector(".theme");
const goBtn = hero.querySelector(".go"); // the arrow to the next page (or back): a real link, drawn in dots like the theme switch

// ------------------------------------------------------------------ theme
// Dark (true black) and light (true white). The first paint already has the right one (index.html). Switching is the
// loading's fill, only faster, and it spreads out from the switch: the progress below eases out over THEME_MS (the
// build's own rate curve has abrupt bursts that, squeezed into a second, read as stop-and-go), and in the shader every cell, the background included, flips
// palette when that progress passes its own rank (mostly its distance from the switch, with random per-pixel jitter), so
// the pixels themselves change state, at random, a front of them moving out from the button.
const themeCurve = (t) => 1 - Math.pow(1 - t, 2.4); // quick at first, a long soft landing; monotone, no stop-and-go
const theme = {
  mode: html.getAttribute("data-theme") === "light" ? "light" : "dark",
  from: 0, to: 0, // 0 dark … 1 light: the state the change leaves and the one it reaches
  p: 1, // its progress 0..1 (1 at rest)
  t0: 0, dur: 0,
};
theme.from = theme.to = theme.mode === "light" ? 1 : 0;
const domTheme = (mode) => {
  html.setAttribute("data-theme", mode);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute("media");
    m.setAttribute("content", THEME_COLOR[mode]);
  });
};
function setTheme(mode, store = true) {
  if (mode === theme.mode) return;
  if (theme.dur) {
    // asked again mid-change: the one running lands at once (a few unflipped pixels jump), the new one starts from there
    theme.dur = 0;
    theme.p = 1;
    domTheme(theme.mode);
  }
  theme.from = theme.mode === "light" ? 1 : 0;
  theme.to = mode === "light" ? 1 : 0;
  theme.mode = mode;
  theme.p = 0;
  theme.t0 = performance.now();
  theme.dur = !scene || reduce ? 0 : THEME_MS;
  themeBtn.setAttribute("aria-label", mode === "light" ? "Switch to dark mode" : "Switch to light mode");
  if (!theme.dur) {
    theme.p = 1;
    domTheme(mode);
    scene?.draw();
  }
  if (store) {
    try {
      localStorage.setItem("cc-theme", mode);
    } catch {
      /* storage unavailable: the choice just lasts for this visit */
    }
  }
}
function stepTheme(now) {
  if (!theme.dur) return;
  const t = clamp01((now - theme.t0) / theme.dur);
  theme.p = themeCurve(t);
  if (t >= 1) {
    theme.p = 1;
    theme.dur = 0;
    domTheme(theme.mode);
  }
}
themeBtn.setAttribute("aria-label", theme.mode === "light" ? "Switch to dark mode" : "Switch to light mode");
themeBtn.addEventListener("click", () => setTheme(theme.mode === "dark" ? "light" : "dark"));
matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  let saved = null;
  try {
    saved = localStorage.getItem("cc-theme");
  } catch {
    /* ignore */
  }
  if (!saved) setTheme(e.matches ? "light" : "dark", false); // follow the system until the visitor chooses
});
themeBtn.addEventListener("pointerenter", (e) => {
  if (e.pointerType === "touch") return;
  state.link = true;
  state.tog.hover = true;
});
themeBtn.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "touch") return;
  state.link = false;
  state.tog.hover = false;
});
themeBtn.addEventListener("focus", () => {
  if (!themeBtn.matches(":focus-visible")) return;
  state.tog.focus = true;
  state.focusUI = themeBtn; // (the compose pass underlines it)
  if (reduce) {
    state.focusUIAmt = 1;
    state.tog.hot = 1;
    scene?.draw();
  }
});
themeBtn.addEventListener("blur", () => {
  if (!state.tog.focus) return;
  state.tog.focus = false;
  if (state.focusUI === themeBtn) state.focusUI = null;
  if (reduce) {
    state.focusUIAmt = 0;
    state.tog.hot = 0;
    scene?.draw();
  }
});

// the arrow to the next page (or back): the same states as the theme switch (hover brightens it, focus underlines it)
if (goBtn) {
  goBtn.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    state.link = true;
    state.go.hover = true;
  });
  goBtn.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    state.link = false;
    state.go.hover = false;
  });
  goBtn.addEventListener("focus", () => {
    if (!goBtn.matches(":focus-visible")) return;
    state.go.focus = true;
    state.focusUI = goBtn;
    if (reduce) {
      state.focusUIAmt = 1;
      state.go.hot = 1;
      scene?.draw();
    }
  });
  goBtn.addEventListener("blur", () => {
    if (!state.go.focus) return;
    state.go.focus = false;
    if (state.focusUI === goBtn) state.focusUI = null;
    if (reduce) {
      state.focusUIAmt = 0;
      state.go.hot = 0;
      scene?.draw();
    }
  });
}

// ------------------------------------------------------------------ wordmark texture
// The SVG paths are rasterised once, their corners rounded, and per texel we store:
//   R coverage · G distance to the edge inside a letter · B closeness to a letter outside it.
const VBW = 90;
const VBH = 15.75;
const TEXELS_PER_UNIT = 22;
const TEX_H = VBH * TEXELS_PER_UNIT; // texels per wordmark height
const HOME_LAYOUT = { w: VBW, h: VBH, tpu: TEXELS_PER_UNIT }; // a sheet's drawing space, in units, and its texels per unit
const HALO = 170; // texels: range of the outside distance (soft edges)
const MARGIN = HALO + 10; // transparent border so outside distances fit and sampling past the edge reads 0
const DEPTH = 55; // texels: range of the inside distance
const ROUND_OPEN = 17; // texels (≈ 4.9% of the letter height): radius of the outer corners
const ROUND_CLOSE = 9; // texels (≈ 2.6%): radius of the inner corners
const BRAND_H = logoSvg.getBoundingClientRect().height < 60 ? 11.2 : 9.5; // viewBox units: every brand mark has this same height, centred on its letter (letters are 15.75); a little taller on small wordmarks, which have fewer dots to draw them with
const BRAND_ROUND = [4, 3]; // texels: a light rounding for the brand marks (they have thin strokes)

// Each brand mark's real extent (its path, rasterised once), so all of them share one height and centre line.
// A mark too wide for its letter's column is narrowed to fit (and then is a little shorter).
const brandFit = LETTER_BRANDS.map((key, i) => {
  const N = 240;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.scale(N / 24, N / 24);
  x.fill(new Path2D(BRANDS[key].d), BRANDS[key].evenodd ? "evenodd" : "nonzero");
  const d = x.getImageData(0, 0, N, N).data;
  let x0 = N, y0 = N, x1 = 0, y1 = 0;
  for (let p = 0; p < N * N; p++) {
    if (d[p * 4 + 3] < 128) continue;
    const px = p % N;
    const py = (p / N) | 0;
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px + 1);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py + 1);
  }
  const [bx, by, bw, bh] = [x0 / 10, y0 / 10, (x1 - x0) / 10, (y1 - y0) / 10];
  const col = (LETTER_EDGES[i + 1] < 1.5 ? LETTER_EDGES[i + 1] * VBW : VBW) - (LETTER_EDGES[i] > 0 ? LETTER_EDGES[i] * VBW : 0);
  const s = Math.min(BRAND_H / bh, (col - 1.2) / bw);
  return { x: LETTER_CENTERS[i] * VBW - (bx + bw / 2) * s, y: VBH / 2 - (by + bh / 2) * s, s, w: bw * s, h: bh * s }; // (w, h: the mark's own box, in viewBox units)
});

// Rasterise shapes (drawn by `draw(ctx)` in viewBox units) into the texture layout both faces share:
//   R coverage · G distance to the edge inside · B closeness to a shape outside · A tone (0..1, drawn by
//   `tone(ctx)` in greys; 1 where nothing is drawn). Corners are rounded first.
function buildMaskTexture(draw, rOpen, rClose, tone, layout = HOME_LAYOUT) {
  const TPU = layout.tpu;
  const cw = Math.round(layout.w * TPU);
  const ch = Math.round(layout.h * TPU);
  const tw = cw + MARGIN * 2;
  const th = ch + MARGIN * 2;

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, tw, th);
  ctx.translate(MARGIN, MARGIN);
  ctx.scale(TPU, TPU);
  ctx.fillStyle = "#fff";
  draw(ctx);

  const rgba = ctx.getImageData(0, 0, tw, th).data;
  const n = tw * th;
  let tones = null;
  if (tone) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, tw, th);
    ctx.translate(MARGIN, MARGIN);
    ctx.scale(TPU, TPU);
    tone(ctx);
    tones = ctx.getImageData(0, 0, tw, th).data;
  }
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = rgba[i * 4] > 127 ? 1 : 0;
  const solid = rOpen > 0 || rClose > 0 ? roundCorners(raw, tw, th, rOpen, rClose) : raw; // (no rounding asked: the shapes stay as drawn)
  const inside = distanceTransform(solid, tw, th, 0);
  const outside = distanceTransform(solid, tw, th, 1);

  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = solid[i] * 255;
    data[i * 4 + 1] = Math.round(clamp01(inside[i] / DEPTH) * 255);
    data[i * 4 + 2] = Math.round(clamp01(1 - outside[i] / HALO) * 255);
    data[i * 4 + 3] = tones ? tones[i * 4] : 255;
  }
  return { data, tw, th, cw, ch };
}

// the letter face: the wordmark's own paths
const buildWordmarkTexture = () =>
  buildMaskTexture((ctx) => logoSvg.querySelectorAll(".lt path").forEach((p) => ctx.fill(new Path2D(p.getAttribute("d")))), ROUND_OPEN, ROUND_CLOSE);

// the brand face: each letter's brand mark, upright, in the same place as its letter. A mark with `tones`
// (the envelope) is its body minus a cut-out gap, with grey tone layers painted into the alpha channel.
function placeBrand(ctx, i, fn) {
  const { x, y, s } = brandFit[i];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  fn(BRANDS[LETTER_BRANDS[i]]);
  ctx.restore();
}
const buildBrandTexture = () =>
  buildMaskTexture(
    (ctx) =>
      LETTER_BRANDS.forEach((_, i) =>
        placeBrand(ctx, i, (b) => {
          if (!b.tones) return ctx.fill(new Path2D(b.d), b.evenodd ? "evenodd" : "nonzero");
          ctx.fill(new Path2D(b.body));
          ctx.globalCompositeOperation = "destination-out";
          ctx.lineWidth = b.gapWidth;
          ctx.lineJoin = "round";
          ctx.stroke(new Path2D(b.gap));
          ctx.globalCompositeOperation = "source-over";
        })
      ),
    ...BRAND_ROUND,
    (ctx) =>
      LETTER_BRANDS.forEach((_, i) =>
        placeBrand(ctx, i, (b) => {
          if (!b.tones) return;
          ctx.save();
          ctx.clip(new Path2D(b.body));
          for (const [d, v] of b.tones) {
            const g = Math.round(v * 255);
            ctx.fillStyle = `rgb(${g},${g},${g})`;
            ctx.fill(new Path2D(d));
          }
          ctx.restore();
        })
      )
  );

// ------------------------------------------------------------------ a page's sheet
// A page is real DOM (a <section data-page> with words and links, laid out by CSS in a box of a fixed shape). Its sheet is that
// DOM drawn in the home's own texture layout: the words in heavy rounded strokes (the home's shapes are fat: its edge ramp is a few
// cells wide, so a hairline would melt away), and beneath each link an arrow, which the curtain and the wave reveal as they do
// the home's brand marks. The box is PAGE_LAYOUT.w units wide, as the wordmark is 90; everything in the page is sized from its
// width (CSS), so the sheet does not depend on the window.
const PAGE_LAYOUT = { w: 90, h: 50, tpu: 11 };
function buildPageMasks(el) {
  const box = el.getBoundingClientRect();
  const k = PAGE_LAYOUT.w / box.width; // units per CSS px
  const words = [...el.querySelectorAll("[data-t]")].map((n) => {
    const cs = getComputedStyle(n);
    const range = document.createRange();
    range.selectNodeContents(n);
    const tr = range.getBoundingClientRect();
    const text = cs.textTransform === "uppercase" ? n.textContent.trim().toUpperCase() : n.textContent.trim();
    return { text, x: (tr.left - box.left) * k, y: (tr.top + tr.height / 2 - box.top) * k, size: parseFloat(cs.fontSize) * k, family: cs.fontFamily, spacing: (parseFloat(cs.letterSpacing) || 0) * k };
  });
  const arrows = [...el.querySelectorAll("a")].map((a) => {
    const r = a.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - box.left) * k, y: (r.top + r.height / 2 - box.top) * k, size: Math.min(r.height, r.width) * k, back: a.hasAttribute("data-back") };
  });
  const face = buildMaskTexture(
    (ctx) => {
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#fff";
      for (const w of words) {
        ctx.font = `900 ${w.size}px ${w.family}`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = `${w.spacing}px`;
        ctx.lineWidth = w.size * 0.06;
        ctx.strokeText(w.text, w.x, w.y);
        ctx.fillText(w.text, w.x, w.y);
      }
    },
    0, 0, null, PAGE_LAYOUT
  );
  const beneath = buildMaskTexture(
    (ctx) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#fff";
      for (const a of arrows) {
        const s = a.size * 0.5, d = a.back ? -1 : 1; // an arrow the height of its link: a shaft and a head
        ctx.lineWidth = s * 0.3;
        ctx.beginPath();
        ctx.moveTo(a.x - s * d, a.y);
        ctx.lineTo(a.x + s * d, a.y);
        ctx.moveTo(a.x + s * d * 0.25, a.y - s * 0.65);
        ctx.lineTo(a.x + s * d, a.y);
        ctx.lineTo(a.x + s * d * 0.25, a.y + s * 0.65);
        ctx.stroke();
      }
    },
    0, 0, null, PAGE_LAYOUT
  );
  return { face, beneath, el };
}

// ------------------------------------------------------------------ shaders
// Two passes. FIELD runs at one fragment per dither cell into a texture; COMPOSE runs at device pixels and
// upscales the cells (each cell an exact CELL × CELL square).
const VERT = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

// Shared by the scene shader (FIELD) and the compose pass, whose on-screen icons change palette in step with the scene.
const LIGHT_SOFT = 0.08; // an icon dot's light-up: softness of its arrival…
const LIGHT_OVER = 1.25; // …overshoot of the progress, so every dot has arrived by the end
const THEME_SOFT = 0.14; // the theme change: each cell fades over this much of the progress (about 100 ms at the start, longer later: several frames, never a pop)…
const THEME_SPATIAL = 0.78; // …in an order that is this much its distance from the switch (spreading out), the rest random per pixel

// how the pointer and the waves push the field around
const PUSH = `
uniform vec2  uDev;       // canvas size, device px
uniform vec3  uE;         // the pointer's gradient centre: x, y (device px), presence 0..1
uniform vec2  uEV;        // its velocity, device px / s
uniform float uER;        // its push radius, device px (already tightened over a link)
uniform vec4  uW[${MAX_WAVES}];      // waves: x, y (device px), age (s, < 0 = off), amplitude
uniform float uTime;
uniform sampler2D uBlue;

#define PUSH_AMT 0.6       // radial push, × pointer radius
#define DEFLECT 0.35       // sideways deflection at speed, × pointer radius
#define RING 0.35   // density piled up where the pushed field compresses (it was 0.75: a second, visible orbit)
#define THIN 0.6           // density cleared inside the pointer's reach (its gradient reads clean)
#define WAKE 0.3   // density in the short wake behind a moving pointer (it was 0.5)
#define STRETCH 0.1        // the push stretches this much along the motion at speed (subtle)
#define BREATHE 0.03       // the pointer's radius breathes this much, slowly
#define WAVE_SPEED 1.05    // screen heights per second (passes the farthest corner within its life)
#define WAVE_WIDTH 0.1     // screen heights: the ring's half-width (a long, smooth swell)
#define WAVE_PUSH 0.008    // screen heights: how far the ring displaces the dots (gentle)
#define WAVE_DENS 0.4      // density/brightness swell at the ring (a quiet ripple, not an event)

float blue(vec2 p) {
  return texture2D(uBlue, (mod(p, 64.0) + 0.5) / 64.0).r;
}

float pointerR() {
  return uER * (1.0 + BREATHE * sin(uTime * 0.7));
}

// returns the displacement (device px) to subtract from a sample position, and in .z the extra density
// where the field is compressed (around the pointer, its wake, the wave fronts)
vec3 pushAt(vec2 p) {
  vec3 o = vec3(0.0);
  vec2 d = p - uE.xy;
  float r = length(d) + 0.001;
  vec2 dir = d / r;
  float sp = length(uEV);
  float fast = clamp(sp / (uER * 14.0), 0.0, 1.0);
  float R = pointerR();
  if (sp > 1.0) R *= 1.0 + STRETCH * fast * abs(dot(dir, uEV / sp));
  float f = uE.z * exp(-(r * r) / (R * R));
  vec2 perp = vec2(-dir.y, dir.x);
  // like a charge moving through a field: pushed outward, and bent sideways relative to the motion
  float side = sign(dir.x * uEV.y - dir.y * uEV.x);
  o.xy += dir * PUSH_AMT * R * f;
  o.xy += perp * side * DEFLECT * R * f * fast;
  o.z += uE.z * RING * exp(-pow((r - 1.25 * R) / (0.4 * R), 2.0));
  o.z -= uE.z * THIN * exp(-pow(r / (1.0 * R), 2.0));
  if (sp > 1.0) {
    vec2 tail = uE.xy - uEV * 0.07;
    o.z += uE.z * WAKE * fast * exp(-dot(p - tail, p - tail) / (R * R * 1.4));
  }
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uW[i];
    if (w.z < 0.0) continue;
    vec2 dw = p - w.xy;
    float rw = length(dw) + 0.001;
    float front = w.z * WAVE_SPEED * uDev.y;
    float x = (rw - front) / (WAVE_WIDTH * uDev.y);
    // one long, quiet ring
    float r0 = exp(-x * x);
    o.xy += dw / rw * r0 * w.w * WAVE_PUSH * uDev.y;
    o.z += r0 * w.w * WAVE_DENS;
  }
  return o;
}
`;

const FIELD = `
precision highp float;
#define DEPTH_TX ${DEPTH.toFixed(1)}
#define HALO_TX ${HALO.toFixed(1)}

// ---- knobs
#define DENS_L 0.72        // share of lattice sites lit inside a letter
#define DENS_WAVE 0.25     // swing of the slow brightness wave inside letters
#define DENS_E 0.3         // extra letter density around the pointer
#define EDGE_SOFT 3.6      // letter edge: width of the density ramp, in cells (merges with the field)
#define EDGE_HOVER 0.3     // … × this right around the pointer (crisper there)
#define EDGE_NOISE 2.2     // roughness of that ramp, in cells
#define EDGE_REF 90.0      // both are tuned for a wordmark this many cells tall; a smaller one (a phone) gets them in proportion…
#define EDGE_MIN 0.45      // …down to this share (so its letters are not blurrier than a big screen's)
#define TONE_DENS 0.3      // dot density of a mark's darkest tone layer (the envelope's sides), × full
#define TONE_BRIGHT 0.5    // …and its brightness
#define CURTAIN_FEATHER 0.35 // the curtain: a soft disc around the pointer, its edge feathered over this, × its radius…
#define CURTAIN_WOBBLE 0.18  // …and gently, slowly wobbled by noise this much, × its radius
#define MORPH_RIPPLE 0.5   // under the curtain each site switches at its own moment: this much smooth spatial noise…
#define MORPH_NOISE 2.2    // …at this scale (per letter height), the rest its own blue-noise rank…
#define MORPH_SOFT 0.08    // …taking this share of the reveal to switch…
#define MORPH_DRIFT 0.05   // …drifting up to this far toward the new shape (× letter height)…
#define MORPH_DIP 0.6      // …and dimming this much while it does
#define REPEL 0.5          // oil on water: the film of dots is pushed out this far at the centre (× curtain radius)…
#define REPEL_W 0.9        // …the push decays smoothly over this radius (× curtain radius), so it never folds…
#define REPEL_SOFT 0.12    // …the opening's edge softens over this (× curtain radius)…
#define REPEL_RIM 1.6      // …and the displaced dots gather at the rim, up to this much denser
#define MELT_RIPPLE 0.25   // a letter's own change (the melt): the moment shifts this much across the letter…
#define MELT_NOISE 1.4     // …along a smooth noise at this scale (per letter height)…
#define MELT_WARP 0.06     // …space bends this much mid-way (× letter height, a slow flow field)…
#define MELT_DIP 0.35      // …and intensities dip this much mid-way
#define PULSE_L 0.3        // convergence pulse: letters this much denser…
#define PULSE_THIN 0.45    // …the field this much thinner…
#define PULSE_GATHER 0.05  // …and gathered this much toward the wordmark (× distance)
#define BUILD_GAIN 1.03    // arrival rate (≥ 1 so every site has arrived when the build ends)
#define FLASH 0.06         // a dot flashes bright on arrival, fading over this much of the build
#define DOT_FADE 0.12      // a dot fades over this much density past its threshold (no popping)
#define DOT_FLOOR 0.3      // below this intensity a dot is fully off
#define TONE_L 0.97        // letter dot tone
#define TWINKLE 0.3        // per-dot twinkle depth (letters at 35% of it)
#define FIELD_TINT vec3(0.9, 0.94, 1.0)
#define SEA_AMP 0.9        // calm-sea drift at rest, cells
#define SEA_STIR 4.0       // extra drift near the last interaction, × energy, cells
#define SEA_GLOBAL 1.2     // extra drift everywhere, × energy, cells
#define SEA_SCALE 0.3      // swell size, screen heights
#define SEA_SPEED 0.05     // swell speed
#define SEA_RIPPLE 0.07    // ripple frequency, per cell (≈ 14-cell clusters)
#define GRAD_R 0.7   // the pointer's gradient: radius (gaussian, × the push radius), a little wider and softer than it was (0.6)…
#define GRAD_D 0.5   // …its density at the centre: it was 0.95, which read as a bright white orbit round the ring; now it is a faint haze…
#define GRAD_TONE0 0.12    // the gradient's dots: brightness at its edge…
#define GRAD_TONE1 0.42    // …and at its centre (the ring itself stays full white)
#define MOAT 1.5           // a thin dark moat around the nucleus, out to this × its radius
#define HOLE 0.5           // …and the nucleus is a ring: its black hole is this × the nucleus radius
#define FLICK_C 0.8        // every dot wanders between random brightnesses at its own pace: how deep (the field)…
#define FLICK_L 0.4        // …(the letters)
#define WREV_LEAD 0.1      // the wave's passage reveals what lies beneath: it rises over this behind the front…
#define WREV_HOLD 0.36     // …holds until here (screen heights behind the front)…
#define WREV_TAIL 0.5      // …and comes back over this
#define WREV_THIN 0.65     // the field thins this much while the wave is behind it
#define WNULL_AT 0.07      // right behind the front the dots' energy is cancelled: where…
#define WNULL_W 0.05       // …how wide…
#define WNULL 0.9          // …how deep
#define LIGHT_SOFT ${LIGHT_SOFT}
#define LIGHT_OVER ${LIGHT_OVER}
#define LIGHT_FLASH 0.3    // …and how long an arriving dot flashes (of the progress)
#define THEME_SOFT ${THEME_SOFT}
#define THEME_SPATIAL ${THEME_SPATIAL}
#define LIGHT_INK 0.7      // light theme: letters and marks are ink, not dots: extra density, so every cell is lit…
#define LIGHT_FIELD 1.7    // …the field's dots darken (greys of many tones, for contrast against the black)…
#define LIGHT_FIELD_DENS 1.35 // …and come a little denser…
#define FLICK_L_INK 0.22   // …and the letters flicker less (they read black)
#define BG_D vec3(0.0)                       // dark: true black…
#define FG_D vec3(0.9412, 0.9373, 0.9176)    // …and paper #f0efea
#define BG_L vec3(1.0)                       // light: true white…
#define FG_L vec3(0.0)                       // …and true black

${PUSH}

uniform vec2  uCells;     // field size, in cells
uniform float uCell;      // device px per cell
uniform float uIntro;
uniform vec4  uLogo;      // x, y (bottom-left), w, h of the wordmark, in cells
uniform vec2  uTexScale;
uniform vec2  uTexOff;
uniform float uTexPerCell;
uniform vec4  uLet[5];    // per letter: amt (0 letter … 1 mark), mirror x, mirror y
uniform float uColE[4];   // the sheet's columns: the four gaps' midpoints, and the five centres (u, 0 … 1 across the sheet)
uniform float uColC[5];
uniform float uAlpha;     // 0: the field's alpha is 1 (the home); 1: it is how much a lit dot belongs to the sheet (the walk reads it)
uniform sampler2D uBrand;
uniform vec4  uRev;       // the curtain: centre x, y (device px), radius (device px), openness 0..1
uniform float uRep;       // the repel around it (oil on water), 0..1, viscous (JS)
uniform vec4  uN;         // the nucleus: x, y (device px), presence, radius (device px)
uniform float uLink;      // the pointer is over a letter-link (0..1)
uniform float uPulse;     // convergence pulse 0..1
uniform vec3  uSea;       // calm-sea drift: amplitude (cells), stir x, y (device px)
uniform float uEnergy;    // stirred-up energy 0..1 (afterglow)
uniform vec4  uFocus;     // keyboard-focused letter, device px
uniform float uFocusAmt;
uniform sampler2D uMask;
uniform vec3  uThemeT;    // the theme change: from, to (0 dark … 1 light), progress 0..1 (1 at rest)
uniform vec3  uThemeO;    // …where it spreads from: the switch's x, y (device px), and the farthest corner's distance

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
// white noise without a tile: every cell its own random number (no sine, so no diagonal artefacts at large coordinates).
// The blue-noise map repeats every 64 cells (and its neighbours are anti-correlated), which the eye reads as a pattern.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
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

// the field: 1 at the wordmark, falling off toward the edges, warped by slow noise
float fieldAt(vec2 p) {
  vec2 lc = uLogo.xy + 0.5 * uLogo.zw;
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
// A sheet is cut into up to five columns, each its own link: the wordmark's five letters (uColE the four gaps' midpoints, uColC
// the five centres, in u), or one column that is the whole sheet (the gaps past the edge: a page).
float letterIndex(float u) {
  return step(uColE[0], u) + step(uColE[1], u) + step(uColE[2], u) + step(uColE[3], u);
}
float letterCenter(float li) {
  float c = uColC[0];
  for (int i = 1; i < 5; i++) {
    if (abs(float(i) - li) < 0.5) c = uColC[i];
  }
  return c;
}
vec2 letterBounds(float li) {
  float lo = -0.08;
  float hi = 1.08;
  for (int i = 0; i < 5; i++) {
    if (abs(float(i) - li) < 0.5) {
      if (i > 0) lo = uColE[i - 1];
      if (i < 4) hi = uColE[i];
    }
  }
  return vec2(lo, min(hi, 1.08));
}
vec4 letFor(float li) {
  vec4 f = vec4(0.0, 1.0, 1.0, 0.0);
  for (int i = 0; i < 5; i++) {
    if (abs(float(i) - li) < 0.5) f = uLet[i];
  }
  return f;
}
// both shapes share one texture layout: the letter (uMask) or its brand mark (uBrand), in the same place
vec4 maskAt(vec2 tc, float brand) {
  float inside = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
  return (brand > 0.5 ? texture2D(uBrand, tc) : texture2D(uMask, tc)) * inside;
}
// signed distance (cells, + inside) and tone of letter li's letter (brand = 0, mirrored by m) or mark (brand = 1).
// It keeps growing outside the letter's column, so a letter never picks up its neighbour's shape; the extreme
// letters' columns end at the wordmark's own edges, so they behave exactly like the middle ones.
vec2 letterSD(float li, vec2 q, float aspect, vec2 m, float brand) {
  float cu = letterCenter(li);
  vec2 qf = vec2(cu + (q.x - cu) * m.x, 0.5 + (q.y - 0.5) * m.y);
  vec2 b = letterBounds(li);
  vec2 qc = vec2(clamp(qf.x, b.x, b.y), clamp(qf.y, -0.45, 1.45));
  float extra = length((qf - qc) * vec2(aspect, 1.0)) * uLogo.w;
  vec4 t = maskAt(qc * uTexScale + uTexOff, brand);
  return vec2((t.r > 0.5 ? t.g * DEPTH_TX : -(1.0 - t.b) * HALO_TX) / uTexPerCell - extra, t.a);
}

// the wave's passage (see pushAt): behind its front, for a moment, what lies beneath the wordmark shows; then it all
// comes back. x = the reveal 0..1. y = the band right behind the front where the dots' energy is cancelled.
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

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 pDev = (cell + 0.5) * uCell;
  vec3 push = pushAt(pDev);
  vec2 c = (pDev - push.xy) / uCell; // where this cell samples the scene from (displaced), in cells

  // calm sea: a slow, low-frequency swell of the field. Stirred-up energy (afterglow) makes it larger and
  // livelier, most around where the interaction happened, then it settles back; the letters drift only a little.
  vec2 sp = c / (SEA_SCALE * uCells.y);
  vec2 sea = vec2(vnoise(vec3(sp, uTime * SEA_SPEED)), vnoise(vec3(sp + 7.7, uTime * SEA_SPEED + 3.1))) - 0.5;
  vec2 chop = vec2(vnoise(vec3(sp * 2.6, uTime * 0.3)), vnoise(vec3(sp * 2.6 + 4.2, uTime * 0.3 + 1.9))) - 0.5;
  float stirW = exp(-pow(length(pDev - uSea.yz) / (0.45 * uDev.y), 2.0));
  float stirAmp = uEnergy * (SEA_STIR * stirW + SEA_GLOBAL);
  vec2 seaOff = uSea.x * (sea * 2.0 * (SEA_AMP + stirAmp) + chop * 2.0 * stirAmp * 0.6);
  vec2 lc = uLogo.xy + 0.5 * uLogo.zw;
  vec2 cs = c + seaOff + (c - lc) * PULSE_GATHER * uPulse; // the field (gathers in during the pulse)
  vec2 cL = c + seaOff * 0.3 * uEnergy;                    // the letters
  float rE = length(pDev - uE.xy);
  float eNear = uE.z * exp(-pow(rE / (3.0 * uER), 2.0));
  float th = blue(cell);
  float th2 = blue(cell + vec2(29.0, 13.0));
  // ---- theme: which palette this cell is in. The loading's fill again, only faster, spreading out from the switch: the
  // progress (uThemeT.z, from JS) runs past every cell's own rank at some moment, background cells included, so the
  // very pixels the dots are made of change state, a front of them moving out from the button. The rank is mostly the
  // cell's distance from the switch, with white noise per pixel on top (a hash: no tile, no repeat), so the front is a
  // random dissolve, not a line; each cell fades over a short fluid window. In the light theme letters are ink and the
  // field is greys (see the knobs), so the density and tone rules below follow 'flip' too.
  float thT = hash12(cell + vec2(17.0, 43.0));
  float td = clamp(length(pDev - uThemeO.xy) / max(uThemeO.z, 1.0), 0.0, 1.0);
  float trk = THEME_SPATIAL * td + (1.0 - THEME_SPATIAL) * thT;
  float flip = mix(uThemeT.x, uThemeT.y, smoothstep(trk - THEME_SOFT, trk + THEME_SOFT, uThemeT.z * (1.0 + 2.0 * THEME_SOFT) - THEME_SOFT));
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  // every dot has its own slow phase: it breathes in and out rather than popping
  float tw = 0.5 + 0.5 * sin(uTime * (0.45 + 1.1 * h) + h * 60.0);
  // …and wanders between random brightnesses at its own pace (0.5–2.2 changes a second), smoothly
  float fr = uTime * (0.5 + 1.7 * fract(h * 91.7 + 0.37)) + h * 97.0;
  float fk = fract(fr);
  fk = fk * fk * (3.0 - 2.0 * fk);
  float flick = mix(hash3(vec3(cell, floor(fr))), hash3(vec3(cell, floor(fr) + 1.0)), fk);

  // ---- the curtain: a soft disc around the pointer (on a spring, in JS), its edge feathered and gently wobbling
  vec2 rv = pDev - uRev.xy;
  float wob = vnoise(vec3(rv / max(uRev.z, 1.0) * 1.6, uTime * 0.35)) - 0.5;
  float edge = uRev.z * (1.0 + 2.0 * CURTAIN_WOBBLE * wob);
  float curtain = uRev.w * (1.0 - smoothstep(edge * (1.0 - CURTAIN_FEATHER), edge * (1.0 + CURTAIN_FEATHER), length(rv)));
  // the wave's passage reveals the same way: each site switches at its own moment as the reveal rises and falls
  vec2 wv = waveAt(pDev);
  curtain = max(curtain, wv.x);

  // ---- oil on water: around the curtain's centre the surface film of dots (the letters and the field) is pushed
  // radially outward along smooth flow lines, leaving a clean opening where the mark beneath reads clearly. Material
  // at radius x moves to x + D(x), D = REPEL·R·e^(−(x/W)²); we invert that per cell (a few fixed-point steps), so
  // the opening is empty and the film is compressed just outside it: a soft, denser rim, like the bead at the edge
  // of oil. It opens slowly and closes more slowly (viscous, in JS) and rides the curtain's lagging centre.
  float film = 1.0;
  float rim = 1.0;
  vec2 cLr = cL;
  if (uRep > 0.001) {
    float rr = length(rv) + 0.001;
    float H = REPEL * uRev.z * uRep;
    float W = REPEL_W * uRev.z;
    float x = rr;
    for (int i = 0; i < 4; i++) x = rr - H * exp(-pow(max(x, 0.0) / W, 2.0));
    float xs = max(x, 0.0);
    float dD = -2.0 * xs / (W * W) * H * exp(-pow(xs / W, 2.0));
    film = smoothstep(0.0, REPEL_SOFT * uRev.z, x);
    rim = min(1.0 / max(1.0 + dD, 0.05), REPEL_RIM);
    vec2 off = rv / rr * (xs - rr) / uCell;
    cLr += off;
    cs += off;
  }

  vec2 qU = (cL - uLogo.xy) / uLogo.zw;   // where the marks are (they lie beneath and do not move)
  vec2 q = (cLr - uLogo.xy) / uLogo.zw;   // where the letters' film comes from
  float aspect = uLogo.z / uLogo.w;
  float li = letterIndex(qU.x);
  vec4 lt = letFor(li);

  vec2 pc = (cs - lc) / uCells.y;
  float nz = vnoise(vec3(pc * 4.5, uTime * 0.07)) * 0.65 + vnoise(vec3(pc * 11.0 + 3.0, uTime * 0.11)) * 0.35;
  float wave = vnoise(vec3(pc * 7.0 + vec2(uTime * 0.045, -uTime * 0.02), uTime * 0.3)) - 0.5;
  float resS = clamp(uLogo.w / EDGE_REF, EDGE_MIN, 1.0);
  float soft = EDGE_SOFT * resS * mix(1.0, EDGE_HOVER, eNear);
  float rough = (vnoise(vec3(c * 0.3, uTime * 0.25)) - 0.5) * EDGE_NOISE * resS * mix(1.0, 0.4, eNear);

  // ---- a letter's own change (letter ⇄ mark, amount s): the melt. The two shapes' signed distances are blended, so
  // one shape flows into the other as a single mass; the moment shifts a little across the letter along a smooth
  // noise (the change ripples through it), space bends gently mid-way along a slow flow field, and intensities dip
  // and rise. Continuous in time and space: nothing pops, nothing fragments, nothing is scaled.
  float s = lt.x;
  vec2 qa = qU * vec2(aspect, 1.0);
  float mid = sin(3.14159 * s);
  float sl = clamp(s + (vnoise(vec3(qa * MELT_NOISE, li * 7.0)) - 0.5) * 2.0 * MELT_RIPPLE * mid, 0.0, 1.0);
  sl = sl * sl * (3.0 - 2.0 * sl);
  vec2 warp = (vec2(vnoise(vec3(qa * 1.7, uTime * 0.4)), vnoise(vec3(qa * 1.7 + 5.0, uTime * 0.4 + 3.0))) - 0.5) * 2.0 * MELT_WARP * mid;
  warp.x /= aspect;

  // ---- the curtain's reveal: under it, each lattice site switches from the (melted) letter to the mark at its own
  // moment (blue-noise rank mixed with a smooth spatial noise), drifting a little toward the new shape and dimming
  // while it switches; behind the pointer the sites switch back
  float k = 0.0;
  vec2 flow = vec2(0.0);
  if (curtain > 0.0) {
    float rank = mix(th2, vnoise(vec3(qa * MORPH_NOISE, li * 7.0)), MORPH_RIPPLE);
    k = smoothstep(rank - MORPH_SOFT, rank + MORPH_SOFT, curtain * (1.0 + 2.0 * MORPH_SOFT) - MORPH_SOFT);
    flow = (vec2(vnoise(vec3(qa * 3.0, 1.3)), vnoise(vec3(qa * 3.0 + 5.0, 2.1))) - 0.5) * 2.0 * MORPH_DRIFT;
    flow.x /= aspect;
  }
  float dip = 4.0 * k * (1.0 - k);

  vec2 qM = q + warp + flow * k;
  vec2 sdM = letterSD(li, qM, aspect, lt.yz, 0.0);
  if (s > 0.0) sdM = mix(sdM, letterSD(li, qM, aspect, vec2(1.0), 1.0), sl);
  float letter = smoothstep(-soft, soft, sdM.x + rough) * film;
  float ftone = sdM.y;
  if (k > 0.0) {
    vec2 sdB = letterSD(li, qU + warp - flow * (1.0 - k), aspect, vec2(1.0), 1.0);
    letter = mix(letter, smoothstep(-soft, soft, sdB.x + rough), k);
    ftone = mix(ftone, sdB.y, k);
  }

  // ---- loading: the letters fill with dots, and only the letters. Every lattice site inside them has its own
  // arrival moment (its blue-noise rank) and lands when the fill passes it, so dots land at random all over the
  // letters at the rate of the build curve (BUILD_RATE); each flashes as it lands and settles. The field around is
  // simply there, untouched by the build.
  float flash = 0.0;
  if (uIntro < 1.0) {
    float a = uIntro * BUILD_GAIN;
    float arr = smoothstep(th2 - 0.01, th2 + 0.01, a);
    flash = arr * letter * exp(-max(a - th2, 0.0) / FLASH);
    letter *= arr;
  }

  // (the theme switch's icon is not part of the scene: the compose pass draws it)
  float ex = 0.0;
  float exTone = 1.0;
  float exFlash = 0.0;
  if (ex > letter) {
    letter = ex;
    ftone = exTone;
  }
  flash = max(flash, exFlash);

  // ---- density and tone. One material: letters are where the same dots gather and burn brighter.
  float rip = vnoise(vec3(cs * SEA_RIPPLE, uTime * 0.12));
  float ripple = mix(1.0, 0.35 + 1.3 * rip, clamp(0.6 + 0.6 * uEnergy, 0.0, 1.0));
  float D = densityAt(cs);
  float lumC = (0.018 + 0.05 * D) * (0.45 + nz) * (1.0 + 0.6 * wave) * ripple * (1.0 - PULSE_THIN * uPulse) * film * rim
    * (1.0 - WREV_THIN * wv.x) * (1.0 - WNULL * wv.y) * mix(1.0, LIGHT_FIELD_DENS, flip)
    + push.z * 0.3 * (0.6 + 0.4 * tw);
  float lumL = (DENS_L + 0.5 * wave * DENS_WAVE + DENS_E * eNear + push.z * 0.3 + PULSE_L * uPulse + LIGHT_INK * flip + 0.6 * ex)
    * mix(TONE_DENS, 1.0, ftone) * (1.0 - MORPH_DIP * dip * (1.0 - ex)) * (1.0 - MELT_DIP * mid * (1.0 - ex))
    * mix(mix(rim, 1.0, k), 1.0, ex) * (1.0 - WNULL * wv.y);
  // letters sit on the checkerboard lattice (so dense dots never fuse; in the light theme they are solid ink instead);
  // the field is free blue noise
  float site = mix(1.0, 1.0 - mod(cell.x + cell.y, 2.0), smoothstep(0.2, 0.6, letter) * (1.0 - flip) * (1.0 - step(0.5, ex)));
  float lum = max(mix(lumC, lumL, letter), 0.0); // (the pointer's thinning can push it below zero)
  // a dot's intensity rises smoothly as the density passes its threshold: changes fade, nothing pops
  // (the fade width scales with the density, so sparse dots still come up to full intensity)
  float on = site * clamp((lum - th) / (DOT_FADE * lum + 0.004), 0.0, 1.0);
  float toneC = (0.48 + 0.12 * D + 0.3 * eNear + 0.3 * push.z) * (1.0 - TWINKLE * tw) * (1.0 - FLICK_C * (1.0 - flick)) * mix(1.0, LIGHT_FIELD, flip);
  float toneL = TONE_L * mix(TONE_BRIGHT, 1.0, ftone) * (1.0 - 0.35 * TWINKLE * tw) * mix(0.72, 1.0, smoothstep(0.75, 1.0, uIntro))
    * (1.0 - mix(FLICK_L, FLICK_L_INK, flip) * (1.0 - sqrt(flick)) * (1.0 - ex)); // (the icon does not flicker)
  float tone = mix(mix(toneC, toneL, letter), 1.0, flash);
  vec3 tint = mix(FIELD_TINT, vec3(1.0), max(letter, flash));

  // keyboard focus: a dotted underline under the focused letter
  float under = step(uFocus.x, pDev.x) * step(pDev.x, uFocus.z) * step(abs(pDev.y - (uFocus.y - 3.0 * uCell)), uCell * 0.75);
  if (uFocusAmt > 0.01 && under * (1.0 - mod(cell.x + cell.y, 2.0)) > 0.5 && th < uFocusAmt) {
    on = 1.0;
    tone = 0.95;
    tint = vec3(1.0);
  }

  // ---- the pointer (the system cursor is hidden): a dot with a gradient. A soft, round radial gradient of the
  // same dots, dense and bright at the centre and thinning smoothly outward (it rides the spring), around a small
  // precise nucleus exactly on the hotspot, set off by a thin dark moat so it never drowns in bright letters.
  if (uE.z > 0.01) {
    vec2 dc = pDev - uE.xy;
    float g = exp(-dot(dc, dc) / pow(GRAD_R * pointerR(), 2.0));
    float eLum = GRAD_D * (1.0 + 0.3 * uLink) * g;
    // (its dots light in at random as it appears, instead of the whole gradient fading)
    float eOn = smoothstep(th2 - 0.25, th2 + 0.25, uE.z * 1.5 - 0.25) * clamp((eLum - th) / (DOT_FADE * eLum + 0.004), 0.0, 1.0);
    if (eOn > on) {
      on = eOn;
      tone = mix(GRAD_TONE0, GRAD_TONE1, g); // dim, and cool like the field's own dots, never white: only the ring is bright
      tint = FIELD_TINT;
    }
  }
  // the nucleus is a ring of dots round a black hole, set off by the dark moat; its dots light in at random too
  float rn = length(pDev - uN.xy);
  if (smoothstep(th2 - 0.2, th2 + 0.2, uN.z * 1.4 - 0.2) > 0.5 && rn < uN.w * MOAT) {
    on = (rn < uN.w && rn >= uN.w * HOLE) ? 1.0 : 0.0;
    tone = 1.0;
    tint = vec3(1.0);
  }

  // a dot is either clearly lit or fully off: faint fades never lift the true black (OLED pixels stay off)
  on *= step(DOT_FLOOR, on);
  // both palettes; a cell is in one or the other ('flip', above)
  float amtOn = on * clamp(tone, 0.0, 1.0);
  // (the walk between two sheets needs to tell the sheet's own cells from the field's noise: alpha is that, only when asked.
  // 0 outside the sheet, 0.5 inside its shape where no dot is lit, 1 where one is: the noise inside a letter's shape, and the halo
  // of dots on its soft edge, are the sheet's: they go out with it, and a ghost of the old letters would stay if they did not)
  float ofSheet = step(0.08, max(letter, flash)) * (on > 0.0 ? 1.0 : 0.5);
  gl_FragColor = vec4(mix(mix(BG_D, FG_D * tint, amtOn), mix(BG_L, FG_L * tint, amtOn), flip), mix(1.0, ofSheet, uAlpha));
}
`;

const COMPOSE = `
precision highp float;
uniform sampler2D uField;
uniform sampler2D uBlue;
uniform vec2  uCells;
uniform float uCell;
uniform vec4  uTog;       // theme switch icon: centre x, y (screen cells), radius (cells), lit 0..1
uniform float uHot;       // how hovered / focused it is, 0..1
uniform vec4  uUF;        // keyboard focus underline under it: centre x, y, radius (cells), amount
uniform vec4  uGo;        // the arrow to the next page (or back): centre x, y (screen cells), radius (cells), lit 0..1
uniform float uGoHot;     // how hovered / focused it is
uniform float uGoDir;     // 1: it points right (to the page), -1: left (back)
uniform vec3  uThemeT;    // the theme change: from, to (0 dark … 1 light), progress
uniform vec3  uThemeO;    // …where it spreads from on the screen: x, y (device px), the farthest corner's distance
uniform float uTime;

#define BG_D vec3(0.0)
#define FG_D vec3(0.9412, 0.9373, 0.9176)
#define BG_L vec3(1.0)
#define FG_L vec3(0.0)
#define LIGHT_SOFT ${LIGHT_SOFT}
#define LIGHT_OVER ${LIGHT_OVER}
#define THEME_SOFT ${THEME_SOFT}
#define THEME_SPATIAL ${THEME_SPATIAL}
// the letters' material (the same numbers as the scene shader's): the icons are dots like them
#define ICON_DENS 0.95     // share of lattice sites lit inside an icon (the letters have 0.72; a little more, at this small size)
#define ICON_EDGE 0.9      // the icon's edge: width of the density ramp, in cells (the letters' is ~3.6 cells on a ~90-cell wordmark)
#define DOT_FADE 0.12
#define DOT_FLOOR 0.3
#define TONE_L 0.97
#define TWINKLE 0.3
#define FLICK_L 0.4
#define FLICK_L_INK 0.22
#define LIGHT_INK 0.7

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float blue(vec2 p) {
  return texture2D(uBlue, (mod(p, 64.0) + 0.5) / 64.0).r;
}

// the icons as signed distances (cells, + inside; tp: cells from the icon's centre, R: its radius in cells)
float moonSd(vec2 tp, float R) { // a disc with a bite out of its upper right
  return min(R - length(tp), length(tp - vec2(0.42, 0.32) * R) - 0.82 * R);
}
float sunSd(vec2 tp, float R) { // a small disc and eight short rays
  float d = length(tp);
  float ak = mod(atan(tp.y, tp.x + 0.0001) + 0.3927, 0.7854) - 0.3927;
  float ray = min(1.15 - abs(sin(ak)) * d, min(d - 0.6 * R, R - d));
  return max(0.4 * R - d, ray);
}

float segSd(vec2 p, vec2 a, vec2 b, float r) { // a round-ended stroke from a to b, half-width r (cells, + inside)
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return r - length(pa - ba * h);
}
float arrowSd(vec2 tp, float R) { // an arrow pointing right: a shaft and a head
  float t = 0.17 * R;
  float sd = segSd(tp, vec2(-0.85 * R, 0.0), vec2(0.8 * R, 0.0), t);
  sd = max(sd, segSd(tp, vec2(0.85 * R, 0.0), vec2(0.15 * R, 0.62 * R), t));
  return max(sd, segSd(tp, vec2(0.85 * R, 0.0), vec2(0.15 * R, -0.62 * R), t));
}

// the on-screen icon at this screen cell: rgb and alpha (0 = show the field)
vec4 uiAt(vec2 cell) {
  vec2 c = cell + 0.5;
  float rT = uTog.z + 3.0;
  bool nearT = uTog.w > 0.002 && max(abs(c.x - uTog.x), abs(c.y - uTog.y)) < rT;
  bool nearG = uGo.w > 0.002 && max(abs(c.x - uGo.x), abs(c.y - uGo.y)) < uGo.z + 3.0;
  bool nearF = uUF.w > 0.01 && abs(c.y - (uUF.y - uUF.z - 4.0)) < 1.0 && abs(c.x - uUF.x) < uUF.z;
  if (!nearT && !nearG && !nearF) return vec4(0.0);

  // which palette this cell is in: the theme change spreading out from the switch, as in the scene
  float thT = hash12(cell + vec2(17.0, 43.0));
  float td = clamp(length(c * uCell - uThemeO.xy) / max(uThemeO.z, 1.0), 0.0, 1.0);
  float trk = THEME_SPATIAL * td + (1.0 - THEME_SPATIAL) * thT;
  float flip = mix(uThemeT.x, uThemeT.y, smoothstep(trk - THEME_SOFT, trk + THEME_SOFT, uThemeT.z * (1.0 + 2.0 * THEME_SOFT) - THEME_SOFT));
  float th2 = blue(cell + vec2(29.0, 13.0));
  float moonNow = 1.0 - step(0.5, flip); // a moon in the dark theme, a sun in the light one

  float sdT = nearT ? mix(sunSd(c - uTog.xy, uTog.z), moonSd(c - uTog.xy, uTog.z), moonNow) : -1000.0;
  float sdG = nearG ? arrowSd(vec2((c.x - uGo.x) * uGoDir, c.y - uGo.y), uGo.z) : -1000.0;
  float lit = nearG ? uGo.w : uTog.w; // (the two icons are never within each other's reach)
  float hot = nearG ? uGoHot : uHot;
  float cov = smoothstep(-ICON_EDGE, ICON_EDGE, max(sdT, sdG)) * step(0.002, lit);
  float arrive = smoothstep(th2 - LIGHT_SOFT, th2 + LIGHT_SOFT, lit * LIGHT_OVER - LIGHT_SOFT); // each dot lights at its own moment

  // the same material as the letters: dots on the checkerboard lattice in the dark theme, solid ink in the light one, the
  // edge a ramp of density the dots dither across, each dot twinkling and flickering at its own pace
  float th = blue(cell);
  float lum = (ICON_DENS + LIGHT_INK * flip) * cov;
  float site = mix(1.0, 1.0 - mod(cell.x + cell.y, 2.0), smoothstep(0.2, 0.6, cov) * (1.0 - flip));
  float on = site * clamp((lum - th) / (DOT_FADE * lum + 0.004), 0.0, 1.0) * arrive;
  on *= step(DOT_FLOOR, on);
  float h = hash12(cell + vec2(3.0, 9.0));
  float tw = 0.5 + 0.5 * sin(uTime * (0.45 + 1.1 * h) + h * 60.0);
  float fr = uTime * (0.5 + 1.7 * fract(h * 91.7 + 0.37)) + h * 97.0;
  float fk = fract(fr);
  fk = fk * fk * (3.0 - 2.0 * fk);
  float fi = floor(fr);
  float flick = mix(hash12(cell + vec2(fi * 17.3, 5.0)), hash12(cell + vec2((fi + 1.0) * 17.3, 5.0)), fk);
  float tone = TONE_L * (1.0 - 0.35 * TWINKLE * tw) * (1.0 - mix(FLICK_L, FLICK_L_INK, flip) * (1.0 - sqrt(flick))) * mix(0.8, 1.0, hot);

  // keyboard focus: a dotted underline under the focused icon
  if (nearF && mod(cell.x + cell.y, 2.0) < 0.5 && blue(cell) < uUF.w) {
    on = 1.0;
    tone = 0.95;
  }
  vec3 ground = mix(BG_D, BG_L, flip);
  vec3 ink = mix(mix(BG_D, FG_D, on * tone), mix(BG_L, FG_L, on * tone), flip);
  if (on > 0.002) return vec4(ink, 1.0);
  // the icon's body has its own ground behind its dots (as a letter has: the field does not show through its holes)
  return vec4(ground, step(0.5, cov));
}

void main() {
  // every device pixel shows the field's cell under it (nearest: each cell is a plain square of its own colour), and the theme
  // switch's icon is drawn over it on the same grid
  vec2 cell = floor(floor(gl_FragCoord.xy) / uCell);
  vec3 col = texture2D(uField, (clamp(cell, vec2(0.0), uCells - 1.0) + 0.5) / uCells).rgb;
  vec4 ui = uiAt(cell);
  gl_FragColor = vec4(mix(col, ui.rgb, ui.a), 1.0);
}
`;

// The walk between two sheets (walk.js). Both sheets are drawn by FIELD, each as it looks on its own page; MIX then says, cell by
// cell, which one shows: the old sheet's dot until its moment (it stutters out), the new sheet's from the moment it lands (with
// a flash), and between them nothing; the field's own noise is whichever sheet has no dot there. The carriers, the few dots
// that stay lit on the way, are drawn over the composed screen.
const MIX = `
precision highp float;
uniform sampler2D uA;     // the old sheet's field (alpha: a lit dot of the sheet)
uniform sampler2D uB;     // the new sheet's
uniform sampler2D uOut;   // when the dot at each cell goes out, in 8 bits over uMix.y seconds (255: never)
uniform sampler2D uArr;   // when a dot lands at each cell
uniform vec2  uCells;
uniform vec4  uMix;       // time since the walk began (s), the span of the 8-bit times (s), the flash (s), the pause going out (s)
uniform vec3  uGround;
uniform float uLight;     // 1 in the light theme (the dots are ink)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 uv = (cell + 0.5) / uCells;
  vec4 a = texture2D(uA, uv);
  vec4 b = texture2D(uB, uv);
  float k = uMix.y * 255.0 / 254.0;
  float tOut = texture2D(uOut, uv).r * k;
  float tArr = texture2D(uArr, uv).r * k;
  float t = uMix.x;
  bool aIn = a.a > 0.25;   // the cell is inside the old sheet's shape (a dot of it, or the dark between its dots)
  bool aLit = a.a > 0.75;  // …and a dot is lit
  bool bIn = b.a > 0.25;
  bool bLit = b.a > 0.75;
  // what is there when neither sheet claims the cell: the field's noise (the old sheet's, or the new one's where the old one's
  // shape was), or nothing
  vec3 rest = !aIn ? a.rgb : (!bIn ? b.rgb : uGround);
  vec3 col = rest;
  if (aIn && t < tOut + uMix.w) {
    float u = clamp((t - tOut) / uMix.w, 0.0, 1.0);          // going out: lit less and less often
    bool shown = !aLit || step(fract(u * 9.0 + hash12(cell + vec2(7.0, 3.0))), 1.0 - u) > 0.5;
    col = shown ? a.rgb : rest;
  } else if (bIn && t >= tArr) {
    float f = exp(-(t - tArr) / uMix.z) * (bLit ? 1.0 : 0.0); // landed: a flash that settles
    col = mix(b.rgb, uLight > 0.5 ? vec3(0.0) : vec3(0.9412, 0.9373, 0.9176), 0.85 * f);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const CARRY_VS = `
attribute vec2 aFrom;     // where the walker leaves from and where it goes, in cells
attribute vec2 aTo;
attribute vec4 aPar;      // when it sets off (s), its own two numbers
uniform float uT;         // time since the walk began (s)
uniform float uPause;
uniform float uGhost;     // 0: the walker; 1, 2, 3: where it was one, two, three hops ago
uniform float uCell;
uniform vec2  uDev;
${GLSL_WALK}
varying float vB;
void main() {
  float cells = length(aTo - aFrom);
  float T = walkTime(cells, aPar.y);
  float p = (uT - aPar.x) / T;
  float K = walkHops(T);
  float pq = min(1.0, floor(clamp(p, 0.0, 1.0) * K + aPar.z) / K);   // each walker hops on its own beat
  float walking = step(0.0, p) * step(p, 1.0);
  float show = walking * (uGhost < 0.5 ? 1.0 : step(0.5, cells / K));  // a trail only where a hop is at least half a cell
  vec2 c = floor(mix(aFrom, aTo, max(0.0, pq - uGhost / K)) + 0.5);
  vec2 ndc = ((c + 0.5) * uCell / uDev) * 2.0 - 1.0;
  gl_Position = show > 0.5 ? vec4(ndc, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = uCell;
  vB = 0.95 * pow(0.55, uGhost);
}
`;
const CARRY_FS = `
precision highp float;
uniform vec3 uGround;
uniform vec3 uFg;
varying float vB;
void main() { gl_FragColor = vec4(mix(uGround, uFg, vB), 1.0); }
`;

// ------------------------------------------------------------------ WebGL
// Why the dots did not start, for the one who sees the plain wordmark: it is on <html data-gl-why> and in the console.
function glFail(why) {
  console.warn("hero: no dots, falling back to the SVG:", why);
  html.dataset.glWhy = html.dataset.glWhy ? html.dataset.glWhy + " | " + why : why;
  return null;
}
function createScene() {
  // A browser that refuses the first request (a GPU policy, a privacy mode) may grant a plainer one: try them in turn.
  const gl =
    canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" }) ||
    canvas.getContext("webgl", { antialias: false, alpha: false }) ||
    canvas.getContext("experimental-webgl", { antialias: false, alpha: false });
  if (!gl) return glFail("the browser gave no WebGL context");

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (glFail("a shader did not compile: " + gl.getShaderInfoLog(s)), null);
  };
  const program = (fragSrc, vertSrc = VERT, attribs = ["position"]) => {
    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : (glFail("a program did not link: " + gl.getProgramInfoLog(p)), null);
  };
  const field = program(FIELD);
  const compose = program(COMPOSE);
  if (!field || !compose) return null;
  // (the walk between sheets is an addition: if its shaders do not build, the home still runs, and the page links just open)
  const mixer = program(MIX);
  const carry = program(CARRY_FS, CARRY_VS, ["aFrom", "aTo", "aPar"]);
  const canWalk = !!(mixer && carry);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (unit, filter, wrap) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  };

  // unit 0: wordmark (letter faces) · 1: blue noise · 3: the field (render target) · 4: brand faces
  // (a sheet's two faces, surface and beneath, are drawn from the same texture layout: buildMaskTexture)
  const uploadFace = (m, unit) => {
    const t = texture(unit, gl.LINEAR, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.tw, m.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
    return t;
  };
  const wm = buildWordmarkTexture();
  const wmTex = uploadFace(wm, 0);
  const br = buildBrandTexture();
  const brTex = uploadFace(br, 4);

  texture(1, gl.NEAREST, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 64, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, blueNoise());

  // unit 3: the field (render target)
  const fieldTex = texture(3, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  // the walk: the old sheet's field (unit 5) and the new one's (6) are render targets, and when each cell goes out (2) and
  // lands (7) are 8-bit textures, one texel per cell
  const aTex = texture(5, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const bTex = texture(6, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const outTex = texture(2, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const arrTex = texture(7, gl.NEAREST, gl.CLAMP_TO_EDGE);
  const fboA = gl.createFramebuffer();
  const fboB = gl.createFramebuffer();
  const carryBuf = { from: gl.createBuffer(), to: gl.createBuffer(), par: gl.createBuffer() };

  const locs = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const UF = locs(field, ["uDev", "uE", "uEV", "uER", "uW[0]", "uTime", "uBlue", "uCells", "uCell", "uIntro", "uLogo", "uTexScale", "uTexOff", "uTexPerCell", "uLet[0]", "uBrand", "uRev", "uRep", "uN", "uLink", "uPulse", "uSea", "uEnergy", "uFocus", "uFocusAmt", "uMask", "uThemeT", "uThemeO", "uColE[0]", "uColC[0]", "uAlpha"]);
  const UC = locs(compose, ["uField", "uBlue", "uCells", "uCell", "uTog", "uHot", "uUF", "uThemeT", "uThemeO", "uTime", "uGo", "uGoHot", "uGoDir"]);
  const UM = canWalk ? locs(mixer, ["uA", "uB", "uOut", "uArr", "uCells", "uMix", "uGround", "uLight"]) : {};
  const UK = canWalk ? locs(carry, ["uT", "uPause", "uGhost", "uCell", "uDev", "uHop", "uGround", "uFg"]) : {};

  gl.useProgram(field);
  gl.uniform1i(UF.uMask, 0);
  gl.uniform1i(UF.uBrand, 4);
  gl.uniform1i(UF.uBlue, 1);
  gl.uniform2f(UF.uTexScale, wm.cw / wm.tw, wm.ch / wm.th);
  gl.uniform2f(UF.uTexOff, MARGIN / wm.tw, MARGIN / wm.th);
  gl.uniform1fv(UF["uColE[0]"], LETTER_EDGES.slice(1, 5)); // the wordmark's five letters are its five columns
  gl.uniform1fv(UF["uColC[0]"], LETTER_CENTERS);
  gl.uniform1f(UF.uAlpha, 0);
  gl.useProgram(compose);
  gl.uniform1i(UC.uField, 3);
  gl.uniform1i(UC.uBlue, 1);
  if (canWalk) {
    gl.useProgram(mixer);
    gl.uniform1i(UM.uA, 5);
    gl.uniform1i(UM.uB, 6);
    gl.uniform1i(UM.uOut, 2);
    gl.uniform1i(UM.uArr, 7);
  }

  // A dither cell is ~1/80 of the wordmark's height, between 1 and 1.5 CSS px and never under 2 device px.
  // The canvas itself runs at device pixels; the field pass runs at one fragment per cell.
  const dpr = (query.has("debug") && Number(query.get("dpr"))) || window.devicePixelRatio || 1; // (?debug&dpr=3 imitates a 3× screen)
  let CELL = 3;
  let cells = [1, 1];
  let dev = [1, 1];
  let hr = hero.getBoundingClientRect();
  let quality = 0; // device px added to the cell size by adaptive quality (0..ADAPT_MAX)
  let built = false; // set once everything below exists; until then nothing draws
  let walk = null; // the walk between two sheets, while there is one: { from, to, t, ends, n, hold } (see beginWalk)
  let onWalkEnd = () => {};
  const waveData = new Float32Array(MAX_WAVES * 4);

  function resize() {
    hr = hero.getBoundingClientRect();
    measureLogo();
    // a cell is ~1/80 of the wordmark's height, up to 1.5 CSS px, and never under 2 device px (so a 3× phone gets 0.67 CSS px
    // cells and keeps its density, instead of being drawn as if it were 1×); `quality` makes them coarser if frames run slow
    const cssCell = clamp(state.logoCss[3] / 80, 0, 1.5);
    CELL = Math.max(2, Math.round(dpr * cssCell)) + quality;
    dev = [Math.max(1, Math.round(hr.width * dpr)), Math.max(1, Math.round(hr.height * dpr))];
    cells = [Math.ceil(dev[0] / CELL), Math.ceil(dev[1] / CELL)];
    canvas.width = dev[0];
    canvas.height = dev[1];
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
    for (const [unit, tex, fb] of [[5, aTex, fboA], [6, bTex, fboB]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cells[0], cells[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (walk) endWalk(); // (the cells changed under it: the page it was going to is simply there)
  }

  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      resize();
      if (reduce && built) draw();
    });
  }).observe(hero);
  resize();

  // client px → device px with y up
  const toDev = (x, y) => [(x - hr.left) * dpr, (hr.bottom - y) * dpr];
  const rectDev = (r) => {
    const [x0, y0] = toDev(r.left, r.bottom);
    const [x1, y1] = toDev(r.right, r.top);
    return [x0, y0, x1, y1];
  };

  // The pointer's, the waves' and the clock's uniforms. `neutral` is the sheet seen on its own, untouched (no pointer, no wave):
  // the walk pairs the dots of the two sheets as they lie at rest.
  const wavesNone = Float32Array.from({ length: MAX_WAVES * 4 }, (_, i) => (i % 4 === 2 ? -1 : 0));
  function setCommon(U, neutral = false) {
    const e = state.e;
    const [ex, ey] = toDev(e.x + hr.left, e.y + hr.top);
    gl.uniform2f(U.uDev, dev[0], dev[1]);
    // (a finger needs no ring or gradient under it)
    gl.uniform3f(U.uE, ex, ey, neutral ? 0 : e.str * (1 - state.cur.tk));
    // speed-dependent terms see at most MAX_SPEED, so a flick can never smear the field
    const sp = Math.hypot(e.vx, e.vy);
    const k = sp > MAX_SPEED ? MAX_SPEED / sp : 1;
    gl.uniform2f(U.uEV, e.vx * k * dpr, -e.vy * k * dpr);
    gl.uniform1f(U.uER, POINTER_R * dpr * (1 - 0.15 * state.linkAmt)); // the gradient tightens a little over a link
    gl.uniform4fv(U["uW[0]"], neutral ? wavesNone : waveData);
    gl.uniform1f(U.uTime, state.time);
    gl.uniform2f(U.uCells, cells[0], cells[1]);
    gl.uniform1f(U.uCell, CELL);
  }

  // ---- sheets: what the field draws. The wordmark is one; a page is another (buildPageMasks, below). Each has its two faces
  // (surface and beneath, one texture layout), the box it fills on the screen, and how it is cut into columns (the letters).
  const home = { name: "home", faceTex: wmTex, beneathTex: brTex, tw: wm.tw, th: wm.th, cw: wm.cw, ch: wm.ch, rect: () => state.logoCss, colE: LETTER_EDGES.slice(1, 5), colC: LETTER_CENTERS, let: letterUniform };
  const sheets = new Map([["home", home]]);
  let current = home;
  const pageLet = Float32Array.from({ length: 20 }, (_, i) => (i % 4 === 1 || i % 4 === 2 ? 1 : 0)); // per column: not melted, not mirrored
  function addSheet(name, m) {
    const sheet = {
      name,
      faceTex: uploadFace(m.face, 0),
      beneathTex: uploadFace(m.beneath, 4),
      tw: m.face.tw, th: m.face.th, cw: m.face.cw, ch: m.face.ch,
      rect: () => {
        const r = m.el.getBoundingClientRect();
        return [r.left, r.top, Math.max(1, r.width), Math.max(1, r.height)];
      },
      colE: [2, 2, 2, 2], // one column: the whole sheet is one link's place
      colC: [0.5, 0.5, 0.5, 0.5, 0.5],
      let: pageLet,
    };
    sheets.set(name, sheet);
    return sheet;
  }

  // Pass 1, for one sheet: its field, one fragment per cell, into `target`. The curtain, the wave, the pointer, the sea act on
  // whichever sheet is drawn, as they do on the home.
  function fieldPass(sheet, target, o = {}) {
    const neutral = !!o.neutral;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sheet.faceTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, sheet.beneathTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, cells[0], cells[1]);
    gl.useProgram(field);
    setCommon(UF, neutral);
    gl.uniform2f(UF.uTexScale, sheet.cw / sheet.tw, sheet.ch / sheet.th);
    gl.uniform2f(UF.uTexOff, MARGIN / sheet.tw, MARGIN / sheet.th);
    gl.uniform1fv(UF["uColE[0]"], sheet.colE);
    gl.uniform1fv(UF["uColC[0]"], sheet.colC);
    gl.uniform1f(UF.uAlpha, o.alpha ? 1 : 0);
    const [l, t, w, h] = sheet.rect();
    const unit = state.logoCss[3]; // the effects are the home's size on every sheet: the wordmark's height is the unit
    const [lx, ly] = toDev(l, t + h);
    gl.uniform4fv(UF.uLogo, [lx / CELL, ly / CELL, (w * dpr) / CELL, (h * dpr) / CELL]);
    gl.uniform1f(UF.uTexPerCell, sheet.ch / Math.max(1, (h * dpr) / CELL));
    gl.uniform1f(UF.uIntro, o.intro ?? state.intro);
    gl.uniform4fv(UF["uLet[0]"], sheet.let);
    const cu = state.cur;
    const [cx, cy] = toDev(cu.x + hr.left, cu.y + hr.top);
    gl.uniform4fv(UF.uRev, [cx, cy, CURTAIN_R * unit * dpr * (1 + (TOUCH_CURTAIN - 1) * cu.tk), neutral ? 0 : cu.amt]);
    gl.uniform1f(UF.uRep, neutral ? 0 : cu.rep);
    const e = state.e;
    const [nx, ny] = toDev(e.tx + hr.left, e.ty + hr.top);
    gl.uniform4f(UF.uN, nx, ny, reduce || neutral ? 0 : state.nuc * (1 - cu.tk), NUCLEUS_R * dpr * (1 + 0.25 * state.linkAmt));
    gl.uniform1f(UF.uPulse, neutral ? 0 : state.pulse);
    const [sx, sy] = toDev(state.stir[0] + hr.left, state.stir[1] + hr.top);
    gl.uniform3f(UF.uSea, reduce ? 0 : 1, sx, sy);
    gl.uniform1f(UF.uEnergy, neutral ? 0 : state.energy);
    gl.uniform4fv(UF.uFocus, !neutral && state.focusRect ? rectDev(state.focusRect) : [0, 0, 0, 0]);
    gl.uniform1f(UF.uFocusAmt, neutral ? 0 : state.focusAmt);
    // the theme change spreads out from the switch: its origin, in device px
    const tr = themeBtn.getBoundingClientRect();
    const [tgx, tgy] = toDev(tr.left + tr.width / 2, tr.top + tr.height / 2);
    gl.uniform3f(UF.uThemeT, theme.from, theme.to, theme.p);
    gl.uniform3f(UF.uThemeO, tgx, tgy, Math.hypot(Math.max(tgx, dev[0] - tgx), Math.max(tgy, dev[1] - tgy)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- the walk: the lit dots of the old sheet walk to where the new sheet's are lit (walk.js says when and where)
  /** the cells a sheet lights, seen untouched: read back from its own field (the alpha says which dots are the sheet's) */
  function litCells(sheet) {
    fieldPass(sheet, fboA, { neutral: true, alpha: true, intro: 1 });
    const px = new Uint8Array(cells[0] * cells[1] * 4);
    gl.readPixels(0, 0, cells[0], cells[1], gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lit = [];
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 191) lit.push(i >> 2); // (alpha 1: a lit dot of the sheet)
    return lit;
  }
  /** start walking from the sheet on the screen to `name`; returns the length in seconds, or 0 if there is no walk to make */
  function beginWalk(name) {
    const to = sheets.get(name);
    if (!canWalk || walk || !to || to === current || reduce) return 0;
    const p = pair(litCells(current), litCells(to), cells[0], cells[1]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const [unit, tex, data] of [[2, outTex, p.out], [7, arrTex, p.arr]]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, cells[0], cells[1], 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
    }
    for (const [key, data] of [["from", p.carriers.from], ["to", p.carriers.to], ["par", p.carriers.par]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, carryBuf[key]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    walk = { from: current, to, t: 0, ends: p.ends + 2 * FLASH_S, n: p.carriers.n, hold: false, out: p.out, arr: p.arr };
    return walk.ends;
  }
  /** debug: what the walk sees in a rectangle of cells (x, y from the bottom left): both sheets' fields, and the two times */
  function probe(x, y, w, h) {
    if (!walk) return null;
    draw();
    const out = { a: new Uint8Array(w * h * 4), b: new Uint8Array(w * h * 4), mix: new Uint8Array(w * h * 4), out: [], arr: [] };
    for (const [key, fb] of [["a", fboA], ["b", fboB], ["mix", fbo]]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out[key]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      out.out.push(walk.out[(y + j) * cells[0] + x + i]);
      out.arr.push(walk.arr[(y + j) * cells[0] + x + i]);
    }
    return out;
  }
  function endWalk() {
    if (!walk) return;
    current = walk.to;
    walk = null;
    onWalkEnd(current.name);
  }
  /** one step of the walk: true when it has just ended */
  function stepWalk(dt) {
    if (!walk) return false;
    if (!walk.hold) walk.t += dt;
    if (walk.t < walk.ends) return false;
    endWalk();
    return true;
  }

  // the old sheet's field and the new one's, mixed cell by cell into the field texture
  function mixPass() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, cells[0], cells[1]);
    gl.useProgram(mixer);
    gl.uniform2f(UM.uCells, cells[0], cells[1]);
    gl.uniform4f(UM.uMix, walk.t, SPAN, FLASH_S, PAUSE_S);
    gl.uniform3f(UM.uGround, theme.to, theme.to, theme.to); // (true black; true white)
    gl.uniform1f(UM.uLight, theme.to);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // pass 2: compose at device pixels (and the icons over the field, on the same grid)
  function composePass() {
    const tr = themeBtn.getBoundingClientRect();
    const [tgx, tgy] = toDev(tr.left + tr.width / 2, tr.top + tr.height / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dev[0], dev[1]);
    gl.useProgram(compose);
    gl.uniform2f(UC.uCells, cells[0], cells[1]);
    gl.uniform1f(UC.uCell, CELL);
    gl.uniform4f(UC.uTog, tgx / CELL, tgy / CELL, (ICON_R * dpr) / CELL, state.tog.amt);
    gl.uniform1f(UC.uHot, state.tog.hot);
    const gr = goBtn?.getBoundingClientRect();
    const [ggx, ggy] = gr ? toDev(gr.left + gr.width / 2, gr.top + gr.height / 2) : [0, 0];
    gl.uniform4f(UC.uGo, ggx / CELL, ggy / CELL, (ICON_R * dpr) / CELL, gr && gr.width ? state.go.amt : 0);
    gl.uniform1f(UC.uGoHot, state.go.hot);
    gl.uniform1f(UC.uGoDir, (walk ? walk.to : current) === home ? 1 : -1); // → to the next page, ← back
    const fu = state.focusUI?.getBoundingClientRect();
    const [fgx, fgy] = fu ? toDev(fu.left + fu.width / 2, fu.top + fu.height / 2) : [0, 0];
    gl.uniform4f(UC.uUF, fgx / CELL, fgy / CELL, (ICON_R * dpr) / CELL, fu ? state.focusUIAmt : 0);
    gl.uniform3f(UC.uThemeT, theme.from, theme.to, theme.p);
    gl.uniform3f(UC.uThemeO, tgx, tgy, Math.hypot(Math.max(tgx, dev[0] - tgx), Math.max(tgy, dev[1] - tgy)));
    gl.uniform1f(UC.uTime, state.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // the walkers that stay lit, over the composed screen: each a cell on the grid, with the places it hopped from behind it
  function carriersPass() {
    if (!walk.n) return;
    gl.useProgram(carry);
    gl.uniform1f(UK.uT, walk.t);
    gl.uniform1f(UK.uPause, PAUSE_S);
    gl.uniform1f(UK.uCell, CELL);
    gl.uniform2f(UK.uDev, dev[0], dev[1]);
    gl.uniform1f(UK.uHop, HOP_RATE);
    gl.uniform3f(UK.uGround, theme.to, theme.to, theme.to);
    gl.uniform3f(UK.uFg, 0.9412 * (1 - theme.to), 0.9373 * (1 - theme.to), 0.9176 * (1 - theme.to)); // (paper on black; black on white)
    for (const [key, loc, size] of [["from", 0, 2], ["to", 1, 2], ["par", 2, 4]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, carryBuf[key]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    for (let g = TRAIL; g >= 0; g--) {
      gl.uniform1f(UK.uGhost, g); // (the trail first, the walker last: it is on top)
      gl.drawArrays(gl.POINTS, 0, walk.n);
    }
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); // (and the full-screen triangle's back in place)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  function draw() {
    hr = hero.getBoundingClientRect();
    measureLogo();
    // waves → uniforms
    const now = state.time;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = state.waves[i];
      const age = w ? now - w.t0 : -1;
      const [wx, wy] = w ? toDev(w.x + hr.left, w.y + hr.top) : [0, 0];
      waveData.set([wx, wy, w ? age : -1, w ? (1 - clamp01(age / WAVE_LIFE)) * clamp01(age / 0.2) * (w.k ?? 1) : 0], i * 4);
    }
    if (walk) {
      // between two sheets: each drawn as it is on its own page, then mixed by the walk
      fieldPass(walk.from, fboA, { alpha: true, intro: 1 });
      fieldPass(walk.to, fboB, { alpha: true, intro: 1 });
      mixPass();
    } else fieldPass(current, fbo);
    composePass();
    if (walk) carriersPass();
  }

  built = true;

  // A lost context (the GPU reset, the machine woke, too many contexts) takes every texture with it and the dots with them. The
  // browser gives the context back, but the scene is not rebuilt in place: when it returns, the page loads again (at most once
  // every 10 s, so a GPU that keeps dropping it cannot loop).
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    html.classList.remove("gl");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      const last = Number(sessionStorage.getItem("glReload")) || 0;
      if (Date.now() - last < 10000) return;
      sessionStorage.setItem("glReload", String(Date.now()));
    } catch (_) {}
    location.reload();
  });

  // debug only: the field as rendered (one pixel per cell), cropped to a client-px rect, scaled up `zoom`×
  function cropCells(x, y, w, h, zoom = 3) {
    draw();
    const c0 = Math.floor(((x - hr.left) * dpr) / CELL);
    const r1 = Math.floor(((hr.bottom - y) * dpr) / CELL);
    const cw = Math.ceil((w * dpr) / CELL);
    const ch = Math.ceil((h * dpr) / CELL);
    const r0 = Math.max(0, r1 - ch);
    const px = new Uint8Array(cw * ch * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(c0, r0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = document.createElement("canvas");
    out.width = cw * zoom;
    out.height = ch * zoom;
    const o = out.getContext("2d");
    const img = o.createImageData(cw, ch);
    for (let row = 0; row < ch; row++) img.data.set(px.subarray((ch - 1 - row) * cw * 4, (ch - row) * cw * 4), row * cw * 4);
    const tmp = document.createElement("canvas");
    tmp.width = cw;
    tmp.height = ch;
    tmp.getContext("2d").putImageData(img, 0, 0);
    o.imageSmoothingEnabled = false;
    o.drawImage(tmp, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  // slow frames: one device px coarser (the wordmark keeps its shape, with fewer, bigger dots), at most ADAPT_MAX times
  function coarser() {
    if (quality >= ADAPT_MAX) return false;
    quality++;
    resize();
    return true;
  }

  const cellPx = () => CELL;
  // debug: the composed screen as a data URL (drawn, then read in the same task, before the browser presents it)
  const shot = () => (draw(), canvas.toDataURL("image/png"));

  return {
    draw, rectDev, cropCells, coarser, cellPx, shot, dpr, quality: () => quality, finish: () => gl.finish(),
    // sheets and the walk between them
    canWalk, addSheet, hasSheet: (name) => sheets.has(name), current: () => current.name, setCurrent: (name) => (current = sheets.get(name) ?? current),
    beginWalk, stepWalk, walking: () => !!walk, walkState: () => walk && { from: walk.from.name, to: walk.to.name, t: walk.t, ends: walk.ends, n: walk.n, hold: walk.hold },
    holdWalk: (on, t) => { if (walk) { walk.hold = on; if (t !== undefined) walk.t = t; } },
    onWalkEnd: (fn) => (onWalkEnd = fn),
    probe, cells: () => cells.slice(),
  };
}

// One semi-implicit step of a damped spring: o[k] moves toward target, o[v] is its velocity. [ω, ζ]: ζ = 1 is
// critically damped. Sub-stepped at ≤ 8 ms so it stays stable at 30 fps and after a dropped frame.
function spring(o, k, v, target, [w, z], dt) {
  const n = Math.ceil(dt / 0.008);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    o[v] += (w * w * (target - o[k]) - 2 * z * w * o[v]) * h;
    o[k] += o[v] * h;
  }
  if (!Number.isFinite(o[k])) {
    o[k] = target;
    o[v] = 0;
  }
}

// ------------------------------------------------------------------ pointer, clicks
// The screen is fixed: nothing scrolls, pans or zooms (style.css: no overflow, touch-action: none). What the visitor does
// with it is hover and touch, and the page answers in place. A trackpad pinch (ctrl+wheel) and Safari's pinch gesture would
// zoom the page, so they are ignored; the wheel does nothing else, as there is nothing to scroll.
window.addEventListener("wheel", (e) => scene && !reduce && e.ctrlKey && e.preventDefault(), { passive: false });
["gesturestart", "gesturechange", "gestureend"].forEach((t) => document.addEventListener(t, (e) => scene && !reduce && e.preventDefault()));

function setTarget(e) {
  const r = hero.getBoundingClientRect();
  const st = state.e;
  st.tx = e.clientX - r.left;
  st.ty = e.clientY - r.top;
  if (!st.on) {
    // the pointer's dot appears where the pointer is, without sweeping in from far away
    st.x = st.tx;
    st.y = st.ty;
    st.vx = st.vy = 0;
  }
  st.on = true;
  state.lastInput = performance.now();
}

// the wave: two pulses from (x, y) in hero CSS px; the second leaves a moment after the first (its t0 is in the future
// until then: the shader skips it)
function spawnWave(x, y) {
  if (!scene || reduce) return;
  for (let k = 0; k < WAVE_PULSES; k++) state.waves.push({ x, y, t0: state.time + k * WAVE_PULSE_GAP, k: 1 - WAVE_PULSE_DECAY * k });
  state.energy = Math.max(state.energy, 0.85);
  state.stir = [x, y];
  while (state.waves.length > MAX_WAVES) state.waves.shift();
}

// ------------------------------------------------------------------ touch
// A finger has no hover, so on touch the gestures differ (the layout does not):
//   tap on the wordmark         → every letter melts into its mark and stays (the cycle waits); a tap on a revealed mark
//                                 (then the click) opens its link, so a link is never opened before it was seen
//   tap anywhere else           → hides the marks if they are shown; otherwise sends the wave
//   press and hold, or drag     → the curtain comes to the finger (bigger and a little above it, so the finger does not
//                                 cover it) and follows it; letting go closes it. A hold or a drag never opens a link.
// Marks left shown hide by themselves after REVEAL_HIDE_MS, and when the page is left. Mouse, pen and keyboard keep
// what they had; with reduced motion or no WebGL a tap simply opens the link.
let lastType = "mouse"; // the latest pointerdown's type
let tapQuick = false; // the latest touch ended as a tap (short and still): only then may the click that follows act
let touch = null; // the gesture in progress: { id, t0, x0, y0, x, y, moved, held, onLink }
let revealT0 = 0;
function revealMarks(now = performance.now()) {
  if (revealAll) return;
  revealAll = true;
  revealT0 = now;
  letters.forEach((_, i) => morphTo(i, 1, now));
}
function hideMarks(now = performance.now()) {
  if (!revealAll) return;
  revealAll = false;
  letters.forEach((_, i) => !pinned(i) && morphTo(i, 0, now));
}
function touchHold() {
  if (!touch || touch.held) return;
  touch.held = true;
  setTarget({ clientX: touch.x, clientY: touch.y }); // the curtain opens at the finger
}
function touchDown(e) {
  const now = performance.now();
  state.touchMode = true;
  state.lastInput = now; // the choreography waits while a finger is down
  if (revealAll) revealT0 = now;
  tapQuick = false;
  touch = { id: e.pointerId, t0: now, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, held: false, onLink: !!e.target.closest?.("a, button") };
}
function touchEnd(e) {
  const g = touch;
  touch = null;
  state.e.on = false;
  if (!g) return;
  const quick = e.type === "pointerup" && !g.held && !g.moved && performance.now() - g.t0 < HOLD_MS;
  tapQuick = quick;
  if (!quick || g.onLink) return; // (on a letter, the click that follows decides: reveal, or open)
  if (revealAll) hideMarks();
  else {
    const r = hero.getBoundingClientRect();
    spawnWave(g.x0 - r.left, g.y0 - r.top);
  }
}
links.forEach((a) => {
  a.addEventListener("click", (e) => {
    if (lastType !== "touch" || e.detail === 0 || !scene || reduce) return; // mouse, keyboard, fallbacks: a plain link
    if (!tapQuick) return e.preventDefault(); // a hold or a drag never opens a link
    if (!revealAll) {
      e.preventDefault(); // the first tap shows what is behind the letters; a tap on a mark opens it
      revealMarks();
    }
  });
});
document.addEventListener("visibilitychange", () => document.hidden && hideMarks());
// a long press on a touch screen is the curtain, not a context menu / "Look Up" (mouse keeps its right-click menu)
window.addEventListener("contextmenu", (e) => scene && !reduce && lastType === "touch" && e.preventDefault());

window.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType === "touch") {
      if (!touch) {
        if (e.buttons !== 0 && (!scene || reduce)) setTarget(e);
        return;
      }
      touch.x = e.clientX;
      touch.y = e.clientY;
      if (!touch.moved && Math.hypot(touch.x - touch.x0, touch.y - touch.y0) > TOUCH_SLOP) {
        touch.moved = true;
        touchHold();
      }
      if (touch.held) setTarget(e);
      return;
    }
    state.touchMode = false;
    setTarget(e);
  },
  { passive: true }
);
window.addEventListener(
  "pointerdown",
  (e) => {
    lastType = e.pointerType;
    if (e.pointerType !== "touch") state.touchMode = false;
    if (e.pointerType === "touch" && scene && !reduce) return touchDown(e);
    setTarget(e);
    if (!scene) return;
    // a click on a letter is its link (the browser follows it); anywhere else sends a wave across the screen
    if (reduce || e.target.closest?.("a, button")) return;
    const r = hero.getBoundingClientRect();
    spawnWave(e.clientX - r.left, e.clientY - r.top);
  },
  { passive: true }
);
const pointerOff = (e) => {
  if (e.type === "pointerleave") state.e.on = false;
  else if (e.pointerType === "touch") scene && !reduce ? touchEnd(e) : (state.e.on = false);
};
window.addEventListener("pointerup", pointerOff, { passive: true });
window.addEventListener("pointercancel", pointerOff, { passive: true });
html.addEventListener("pointerleave", pointerOff);

// ------------------------------------------------------------------ loop
const scene = (() => {
  try {
    return createScene();
  } catch (err) {
    return glFail("the scene threw: " + (err && err.stack ? err.stack.split("\n").slice(0, 3).join(" / ") : err));
  }
})();
makeBrandGroups();
// The drawn letters are mirrored (a random identity per visit); the SVG letters, which are the links' hit areas, must be too,
// or a tap lands on the unmirrored shape. (The no-WebGL fallback sets the same each frame.)
letterGroups.forEach((g, i) => (g.style.transform = `scale(${letters[i].mx}, ${letters[i].my})`));
if (scene) html.classList.add("gl");

// ------------------------------------------------------------------ pages
// The home is one sheet; every <section data-page> is another, and the arrow in the corner goes to it (and back). The pages are
// DOM first: with the script off, `:target` shows one and hides the wordmark; with it on but without WebGL, the hash does the same;
// with WebGL the dots of the old sheet walk to the new one (walk.js) and the DOM follows when they have landed.
const pageEls = new Map([...document.querySelectorAll(".page[data-page]")].map((el) => [el.dataset.page, el]));
const logoEl = hero.querySelector(".logo");
const FIRST_PAGE = pageEls.keys().next().value ?? null;
const routeOf = () => {
  const h = decodeURIComponent(location.hash.slice(1));
  return pageEls.has(h) ? h : "home";
};
let shown = "home"; // the sheet whose DOM is live (its links can be reached)
function showDom(name) {
  shown = name;
  html.dataset.page = name;
  logoEl.inert = name !== "home";
  pageEls.forEach((el, k) => {
    el.classList.toggle("on", k === name);
    el.inert = k !== name;
  });
  if (goBtn) {
    const back = name !== "home";
    goBtn.setAttribute("href", back ? "#" : `#${FIRST_PAGE}`);
    goBtn.setAttribute("aria-label", back ? "Back to the home" : `Open ${FIRST_PAGE}`);
  }
  if (document.activeElement?.closest?.("[inert]")) document.activeElement.blur(); // (focus must not stay on what can no longer be reached)
}
/** the page's sheet, built from its DOM the first time it is needed (a second or so: the shapes are measured, then drawn) */
const sheetMs = {}; // how long each page's sheet took to build (ms), for the checks
function ensureSheet(name) {
  if (!scene || name === "home" || scene.hasSheet(name)) return;
  const el = pageEls.get(name);
  const was = el.classList.contains("on");
  const t = performance.now();
  el.classList.add("on"); // (a box with no layout has nothing to measure)
  scene.addSheet(name, buildPageMasks(el));
  el.classList.toggle("on", was);
  sheetMs[name] = Math.round(performance.now() - t);
}
let leaving = false;
let wanted = "home"; // where the visitor last asked to be (the address says so too): what a walk that ends must check
function goTo(name) {
  wanted = name;
  // (the address follows: a link set it already; a call from the console does not, and Back must still lead somewhere)
  if (routeOf() !== name) history.pushState(null, "", name === "home" ? location.pathname + location.search : `#${name}`);
  if (leaving || name === shown) return;
  if (!scene || reduce || !scene.canWalk) {
    ensureSheet(name);
    scene?.setCurrent(name);
    showDom(name);
    scene?.draw();
    return;
  }
  ensureSheet(name);
  const el = pageEls.get(name);
  if (el) {
    el.classList.add("on"); // (it is drawn by the walk, and reachable only once it has landed)
    el.inert = true;
  }
  logoEl.inert = true;
  const len = scene.beginWalk(name);
  if (!len) return showDom(name);
  leaving = true;
  html.classList.add("walking");
  if (goBtn) goBtn.setAttribute("href", name === "home" ? `#${FIRST_PAGE}` : "#"); // (the arrow already turns round)
}
scene?.onWalkEnd((name) => {
  leaving = false;
  html.classList.remove("walking");
  showDom(name);
  if (wanted !== name) goTo(wanted); // (the visitor went back or forward while it walked)
});
// a page's links answer as the letters do: the pointer tightens over one, keyboard focus draws a dotted underline under it
pageEls.forEach((el) =>
  el.querySelectorAll("a").forEach((a) => {
    a.addEventListener("pointerenter", (e) => e.pointerType !== "touch" && (state.link = true));
    a.addEventListener("pointerleave", (e) => e.pointerType !== "touch" && (state.link = false));
    a.addEventListener("focus", () => {
      if (!a.matches(":focus-visible")) return;
      state.focusRect = a.getBoundingClientRect();
      if (reduce) {
        state.focusAmt = 1;
        scene?.draw();
      }
    });
    a.addEventListener("blur", () => {
      state.focusRect = null;
      if (reduce) {
        state.focusAmt = 0;
        scene?.draw();
      }
    });
  })
);
window.addEventListener("hashchange", () => goTo(routeOf()));
wanted = routeOf();
if (routeOf() !== "home") {
  // opened on a page (a link, a reload): the page's dots land from nothing, as the wordmark's do on the home
  ensureSheet(routeOf());
  scene?.setCurrent(routeOf());
  showDom(routeOf());
} else showDom("home");

measureLogo();
new ResizeObserver(measureLogo).observe(hero);

let visible = true;
new IntersectionObserver(([en]) => (visible = en.isIntersecting)).observe(hero);

let last = 0;
const t0 = performance.now();
// every display frame (60/90/120/144 Hz), touch included; if frames stay slow, the dots get coarser (see ADAPT_MS)
let slowEma = 16.7;
let slowFrames = 0;
function adapt(dtMs) {
  if (!scene || dtMs > 250) return; // (a stall: a tab switch, a shader compile; not a rate)
  slowEma += (dtMs - slowEma) * 0.04;
  if (++slowFrames > 90 && slowEma > ADAPT_MS && scene.coarser()) {
    slowEma = 16.7;
    slowFrames = 0;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden) return;
  const dtMs = now - last;
  last = now;
  adapt(dtMs);
  update(now, Math.min(dtMs, 50) / 1000);
  scene?.draw();
}

// one step of everything that moves (dt in seconds, capped by the caller)
function update(now, dt) {
  state.time = FREEZE ?? (now - t0) / 1000;
  // the pointer: the nucleus is the hotspot itself; the gradient's centre follows on a spring, never far behind
  const e = state.e;
  spring(e, "x", "vx", e.tx, POINTER_SPRING, dt);
  spring(e, "y", "vy", e.ty, POINTER_SPRING, dt);
  const lag = Math.hypot(e.x - e.tx, e.y - e.ty);
  const maxLag = POINTER_LAG * POINTER_R;
  if (lag > maxLag) {
    e.x = e.tx + ((e.x - e.tx) * maxLag) / lag;
    e.y = e.ty + ((e.y - e.ty) * maxLag) / lag;
  }
  spring(e, "str", "sv", e.on ? 1 : 0, [20, 1], dt);
  e.str = clamp01(e.str);
  state.linkAmt += (1 - Math.exp(-dt * 14)) * ((state.link && e.on ? 1 : 0) - state.linkAmt);

  // touch: a finger down keeps the choreography paused and the revealed marks up; a long press becomes a hold; marks left
  // alone for a while hide
  if (touch) {
    state.lastInput = now;
    if (revealAll) revealT0 = now;
    if (!touch.held && !touch.moved && now - touch.t0 > HOLD_MS) touchHold();
  }
  if (revealAll && now - revealT0 > REVEAL_HIDE_MS) hideMarks(now);

  // the curtain: open while the pointer is active (after the build is half done), closing softly after it
  const cu = state.cur;
  cu.tk += (1 - Math.exp(-dt * 10)) * ((state.touchMode ? 1 : 0) - cu.tk); // 0 mouse … 1 touch: bigger, and above the finger
  const cuY = e.ty - TOUCH_LIFT * cu.tk;
  const active = e.on && now - state.lastInput <= IDLE_MS && state.intro >= CURTAIN_FROM;
  if (cu.amt < 0.01 && active) {
    cu.x = e.tx;
    cu.y = cuY;
    cu.vx = cu.vy = 0;
  }
  spring(cu, "x", "vx", e.tx, CURTAIN_SPRING, dt);
  spring(cu, "y", "vy", cuY, CURTAIN_SPRING, dt);
  cu.amt += (1 - Math.exp(-dt * (active ? CURTAIN_OPEN : CURTAIN_CLOSE))) * ((active ? 1 : 0) - cu.amt);
  // the repel is viscous: an underdamped spring, slow to open, slower to close, a touch of overshoot at most
  spring(cu, "rep", "rv", active ? 1 : 0, active ? REPEL_OPEN : REPEL_CLOSE, dt);
  cu.rep = clamp(cu.rep, 0, 1.08);

  updateLetters(now);

  // the field's energy: stirred by a moving pointer and by waves; it dies down slowly
  const speed = Math.min(Math.hypot(e.vx, e.vy), MAX_SPEED);
  const stirNow = e.str * (speed / MAX_SPEED);
  if (stirNow > state.energy * 0.5) state.stir = [e.x, e.y];
  state.energy = Math.min(1, state.energy * Math.exp(-dt / AFTERGLOW) + stirNow * dt * 2.2);

  state.focusAmt += (1 - Math.exp(-dt * 12)) * ((state.focusRect ? 1 : 0) - state.focusAmt);

  // the pointer ring's presence, the switch's icon, the theme
  state.nuc += (1 - Math.exp(-dt * 14)) * ((e.on ? 1 : 0) - state.nuc);
  stepTween(state.tog, now);
  state.tog.hot += (1 - Math.exp(-dt * 14)) * ((state.tog.hover || state.tog.focus ? 1 : 0) - state.tog.hot);
  stepTween(state.go, now);
  state.go.hot += (1 - Math.exp(-dt * 14)) * ((state.go.hover || state.go.focus ? 1 : 0) - state.go.hot);
  scene?.stepWalk(dt);
  state.focusUIAmt += (1 - Math.exp(-dt * 12)) * ((state.focusUI ? 1 : 0) - state.focusUIAmt);
  stepTheme(now);
  state.waves = state.waves.filter((w) => state.time - w.t0 < WAVE_LIFE);
}

// ------------------------------------------------------------------ loading (the wordmark accumulates)
// the arrival rate at t (0..1 of the build), and the fill: its integral, tabulated once and normalised
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
  for (let i = 1; i <= n; i++) tab[i] = tab[i - 1] + (buildRate((i - 0.5) / n) / n);
  for (let i = 0; i <= n; i++) tab[i] /= tab[n];
  return tab;
})();
function buildProgress(t) {
  const n = BUILD_TABLE.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return BUILD_TABLE[i] + (BUILD_TABLE[i + 1] - BUILD_TABLE[i]) * (x - i);
}

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
    state.tog.amt = 1;
    state.go.amt = 1;
    html.classList.add("ready");
    updateLetters(performance.now());
    if (scene) {
      scene.draw();
      // one still frame, drawn again once layout and the page have fully settled
      [120, 600, 1500].forEach((ms) => setTimeout(() => scene.draw(), ms));
      const again = () => scene.draw();
      addEventListener("pageshow", again);
      document.addEventListener("visibilitychange", again);
    }
    return;
  }

  // the dots are the pointer now (fine pointers only, see style.css)
  if (scene) html.classList.add("live");
  requestAnimationFrame(frame);
  // Loading is the wordmark accumulating out of the dots. By now the textures are built and the first frame is
  // queued, so this is a minimum duration: the full build on a first visit, a short one after that.
  const full = !seen || forced;
  if (scene) await tween((full ? BUILD_S : BUILD_QUICK) * 1000, (t) => (state.intro = buildProgress(t)));
  html.classList.remove("booting");
  html.classList.add("ready");
  ready = true;
  tweenTo(state.tog, 1, ICON_IN_MS, performance.now());
  tweenTo(state.go, 1, ICON_IN_MS, performance.now());
  // the pages' sheets take a second to build: do it now, while nothing is going on, so that the first walk does not wait for it
  setTimeout(() => pageEls.forEach((_, name) => ensureSheet(name)), 1500);
  try {
    sessionStorage.setItem("cc-boot", "1");
  } catch {
    /* storage unavailable: the build simply plays in full again next time */
  }
}

boot();

// ?debug exposes the live state and a field crop for scripted checks
if (new URLSearchParams(location.search).has("debug")) {
  window.__hero = {
    state,
    letters,
    // the stand-alone cycle: ms into it (null while paused by pointer input) and each letter's amount
    cycle: () => ({ phase: cycleStart === null ? null : Math.round(performance.now() - cycleStart), pulse: +state.pulse.toFixed(2), amt: letters.map((L) => +L.amt.toFixed(2)) }),
    // a timed draw (ms, CPU side plus a GPU finish) for cost checks
    drawCost(n = 60) {
      const t = performance.now();
      for (let i = 0; i < n; i++) scene?.draw();
      scene?.finish();
      return (performance.now() - t) / n;
    },
    // the field as rendered, one pixel per cell, for a client-px rect (scripted visual checks)
    crop: (x, y, w, h, zoom) => scene?.cropCells(x, y, w, h, zoom),
    // advance everything by real time elapsed, in ≤ 16 ms steps (for scripted checks in throttled previews)
    tick() {
      const now = performance.now();
      const from = Math.max(last, now - 2000);
      for (let t = from + 16; t <= now; t += 16) update(t, 0.016);
      last = now;
    },
    // the build's curves on the normalised timeline: arrival rate (share of the top rate) and fill (0..1)
    buildRate,
    buildProgress,
    buildSamples: (ts = BUILD_RATE.flatMap(([a, b]) => [a, b])) => ts.map((t) => ({ t, v: +buildRate(t).toFixed(3), p: +buildProgress(t).toFixed(3) })),
    finish() {
      state.intro = 1;
      ready = true;
      tweenTo(state.tog, 1, ICON_IN_MS, performance.now());
      tweenTo(state.go, 1, ICON_IN_MS, performance.now());
    },
    // the pages: where we are, a way to walk by hand (hold it, then set the second it is at), the sheets and the scene
    pages: () => ({ shown, current: scene?.current(), walk: scene?.walkState(), canWalk: scene?.canWalk, routes: [...pageEls.keys()], buildMs: sheetMs }),
    goTo,
    holdWalk: (on = true, t) => scene?.holdWalk(on, t),
    ensureSheet,
    scene,
    // touch: the gesture state, and a way to drive the same paths with synthetic events
    touchState: () => ({ revealAll, tapQuick, lastType, touch: touch && { held: touch.held, moved: touch.moved }, tk: +state.cur.tk.toFixed(2) }),
    shot: () => scene?.shot(),
    cell: () => scene?.cellPx(),
    dpr: () => scene?.dpr,
    adapt,
    quality: () => scene?.quality(),
    setTheme,
    theme,
    themeCurve,
  };
}
