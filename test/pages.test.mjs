// The home as an engine that carries more than the wordmark (hero.js, walk.js, style.css, index.html): what must stay true.
// The pixels themselves are compared in the browser: tools/home-parity.js (docs/PLANKTON.md §15).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = (p) => readFileSync(new URL(p, import.meta.url)).toString();
const hero = text("../hero.js"), css = text("../style.css"), page = text("../index.html"), parity = text("../tools/home-parity.js");
const shader = (name) => hero.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`))[1];

test("the home's shader is still the home's: the letters' columns are uniforms with the wordmark's own numbers", () => {
  const field = shader("FIELD");
  assert.match(field, /uniform float uColE\[4\]/);
  assert.match(field, /uniform float uColC\[5\]/);
  assert.ok(!/18\.55 \/ 90\.0|36\.15 \/ 90\.0/.test(field), "no letter edge is a constant of the shader any more");
  assert.match(hero, /const LETTER_EDGES = \[-1, 18\.55 \/ 90, 36\.15 \/ 90, 54\.75 \/ 90, 71\.15 \/ 90, 2\]/, "the wordmark's gaps");
  assert.match(hero, /const LETTER_CENTERS = \[8\.9 \/ 90, 27\.35 \/ 90, 45\.45 \/ 90, 62\.95 \/ 90, 80\.8 \/ 90\]/, "and its letters' centres");
  assert.match(hero, /gl\.uniform1fv\(UF\["uColE\[0\]"\], LETTER_EDGES\.slice\(1, 5\)\)/);
  // the field's alpha is 1 unless the walk asks, so the home's field texture is exactly what it was
  assert.match(field, /mix\(1\.0, ofSheet, uAlpha\)/);
  assert.match(hero, /gl\.uniform1f\(UF\.uAlpha, 0\)/);
  for (const knob of ["DENS_L 0.72", "EDGE_SOFT 3.6", "CURTAIN_FEATHER 0.35", "REPEL 0.5", "WAVE_PUSH 0.008", "FLICK_C 0.8", "TONE_L 0.97"]) {
    assert.ok(hero.includes(`#define ${knob}`), `${knob}: the home's number`);
  }
});

test("the parity baseline is there: eight hashes per theme, compared by the harness", () => {
  for (const theme of ["dark", "light"]) {
    const row = parity.match(new RegExp(`${theme}: \\{([^}]*)\\}`))[1];
    assert.equal((row.match(/"[0-9a-f]{3,8}"/g) || []).length, 8, `${theme}: rest, marks, marksWave, wave, each a field and a composed hash`);
  }
  assert.match(parity, /identical/);
  assert.match(hero, /query\.has\("debug"\) && query\.has\("seed"\)/, "the seeded mode is behind ?debug");
});

test("the walk is the shared maths: the carriers' shader takes it from walk.js, and it is drawn after the compose pass", () => {
  assert.match(hero, /import \{[^}]*pair[^}]*GLSL_WALK[^}]*\} from "\.\/walk\.js"/);
  const carry = shader("CARRY_VS");
  assert.ok(carry.includes("${GLSL_WALK}"), "the vertex shader's walkTime and walkHops are walk.js's");
  assert.ok(!/clamp\(cells/.test(carry), "no copy of its own");
  assert.match(hero, /for \(let g = TRAIL; g >= 0; g--\)/, "the trail first, the walker last");
  assert.match(hero, /composePass\(\);\s*if \(walk\) carriersPass\(\);/, "the walkers are over the composed screen");
  assert.match(hero, /fieldPass\(walk\.from, fboA, \{ alpha: true, intro: 1 \}\);\s*fieldPass\(walk\.to, fboB, \{ alpha: true, intro: 1 \}\);\s*mixPass\(\);/, "both sheets are drawn by the same field shader");
  const mix = shader("MIX");
  assert.match(mix, /aIn && t < tOut \+ uMix\.w/, "the old sheet's dot stays until its moment, stuttering out");
  assert.match(mix, /bIn && t >= tArr/, "the new one lands at its");
  assert.ok(!/swarm/.test(hero), "the engine is the home's, not /swarm's");
});

test("a page is DOM first, and the home is the home when there is none", () => {
  assert.ok(!/<a class="go"|<section class="page"/.test(page.replace(/<!--[\s\S]*?-->/g, "")), "no placeholder page ships in the HTML (Lucas, 2026-11-08: 'tchau')");
  assert.match(hero, /\.page\[data-page\]/, "every <section class=page data-page> is a sheet");
  assert.match(hero, /goBtn\?\./, "the arrow is optional: the home runs without it");
  assert.match(css, /\.page:target\s*\{\s*display: flex;/, "without the script a page opens by :target");
  assert.match(css, /:root:not\(\.gl\):has\(\.page:target\) \.logo/, "and the wordmark steps aside, but only where the canvas is not drawing it");
  assert.match(css, /\.gl \.page \{\s*opacity: 0;/, "with WebGL a page is transparent, never hidden: hit-testing, focus and screen readers keep it");
  assert.match(css, /\.walking \.go,\s*\.walking \.logo,\s*\.walking \.page \{\s*pointer-events: none;/, "nothing is pressed while the dots walk");
  assert.match(hero, /history\.pushState/, "the address follows a page (Back works)");
  assert.match(hero, /!scene \|\| reduce \|\| !scene\.canWalk/, "no walk without WebGL or with reduced motion: the page just opens");
  assert.match(hero, /const atHome = shown === "home" && !scene\?\.walking\(\)/, "the wordmark's choreography waits on a page");
});

test("the arrow is the theme switch's twin: a real link, drawn in dots, hover and focus as the switch's", () => {
  const compose = shader("COMPOSE");
  assert.match(compose, /float arrowSd\(/);
  assert.match(compose, /uniform vec4  uGo;/);
  assert.match(compose, /nearG/);
  assert.match(hero, /goBtn\.addEventListener\("pointerenter"/);
  assert.match(hero, /goBtn\.addEventListener\("focus"/);
  assert.match(css, /\.go \{[^}]*width: 44px;[^}]*height: 44px;/s, "a 44 px target");
  assert.match(css, /\.gl \.go svg \{\s*opacity: 0;/, "the SVG is only the fallback");
});

test("a page's sheet is made of the home's own texture layout, and the page is sized from its width", () => {
  assert.match(hero, /function buildMaskTexture\(draw, rOpen, rClose, tone, layout = HOME_LAYOUT\)/);
  assert.match(hero, /const PAGE_LAYOUT = \{ w: 90, h: 50, tpu: 11 \}/);
  assert.match(css, /aspect-ratio: 90 \/ 50;/, "the box is always the sheet's shape");
  assert.match(css, /--pw: clamp\(300px, 64vw, 900px\)/);
  assert.match(hero, /function buildPageMasks\(el\)/);
  assert.match(hero, /ctx\.lineJoin = "round"/, "heavy rounded words: the home's shapes are fat");
});

test("when the dots cannot start the page says why, and a lost context comes back by loading again", () => {
  assert.match(hero, /function glFail\(why\)[\s\S]*?html\.dataset\.glWhy/, "the reason is on <html data-gl-why>");
  assert.match(hero, /getContext\("experimental-webgl"/, "a plainer request is tried before giving up");
  assert.match(hero, /a shader did not compile/);
  assert.match(hero, /a program did not link/);
  assert.match(hero, /try \{\s*return createScene\(\);\s*\} catch \(err\)/, "a throw in the scene is a fallback, not a dead page");
  assert.match(hero, /addEventListener\("webglcontextrestored"[\s\S]*?location\.reload\(\)/);
  assert.match(hero, /Date\.now\(\) - last < 10000/, "and never in a loop");
});
