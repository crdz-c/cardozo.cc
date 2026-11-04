# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen: the **CRDZC** wordmark, centred, drawn as dots in a single dithered dot field. **Each letter is a link**,
and under each letter lies the mark of its link (envelope, LinkedIn, Dribbble, Medium, GitHub). The pointer opens the
wordmark like a curtain and reveals the marks beneath it; left alone, the letters turn into their marks on their own
and every 9 seconds everything converges back into CRDZC. Every change of shape is the same morph: the dots
walk to their places in the next form. The pointer is drawn as a dot with a gradient (the system cursor is hidden); a click
on the background sends one long, quiet ring across the screen. No build step, no dependencies (native ES modules).

```
index.html   the page: the wordmark as inline SVG, each letter an <a> (the real links, focus, screen readers)
style.css    layout; under .gl the SVG stays in place but transparent (the shader draws it)
hero.js      letter/mark textures, the dot-field shader, morphs, curtain, 9 s cycle, pointer, waves, sea, loading
brands.js    the five brand marks as SVG path data
raster.js    exact distance transform, corner rounding, blue-noise threshold map
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.
`?debug` exposes `window.__hero`: live `state`, `letters` (each letter's morph state), `cycle()` (ms into the 9 s
cycle or `null` while paused, the pulse, each letter's amount), `crop(x, y, w, h, zoom)` (the field as rendered, one
pixel per cell), `tick()` (advance everything to now in 16 ms steps, for scripted checks in previews that throttle
animation frames), `buildProgress(s)` (the loading curve) and `finish()` (skip the build).
The page loads no fonts: there is no text on screen.

## Letters are links

| letter | link | brand face |
|---|---|---|
| C | mailto:lucas@cardozo.cc | envelope |
| R | linkedin.com/in/cardozolucas | LinkedIn |
| D | dribbble.com/cardozoconc | Dribbble |
| Z | medium.com/@cardozoconc | Medium |
| C | github.com/crdz-c | GitHub |

The links live in `index.html`: each letter's `<g class="lt">` sits inside an SVG `<a>` with a transparent hit box
over its column, so the whole column is clickable whatever it shows. Web links open in a new tab
(`rel="me noopener"`); each has an `aria-label`. The mark is read from the link's URL, so **remapping is just
reordering the `href`s** in `index.html`. Under `.gl` the SVG is `opacity: 0`, not hidden: hit-testing, keyboard
focus (Tab, Enter) and screen readers keep working. A click or tap on a letter always opens its link, letter or mark.
Keyboard focus shows that letter's mark and a dotted underline under it until focus leaves.

## Letters, marks and the morph

- Each letter has two shapes sharing one texture layout: the letter (the wordmark's own paths, corners rounded) and
  its mark beneath (every mark the same height, `BRAND_H` 9.5 of the wordmark's 15.75 units, centred on the letter,
  narrowed only if its column is too tight). Both are stored as coverage + inside distance + outside distance +
  tone, so a mark is made of the same dots with the same soft edge. **Tone** (texture alpha) scales dot density (down
  to `TONE_DENS` 0.3) and brightness (down to `TONE_BRIGHT` 0.5): the envelope has a bright flap (1.0), lighter
  sides (0.4), a mid-tone bottom (0.68) and a cut-out gap along the flap. The other marks are single-tone.
- A letter's state is one number, 0 (letter) … 1 (mark). **Every change is a morph in which the dots walk**: at
  load, the dots of each letter (as mirrored) and of its mark are sampled on the dot lattice (80 rows per wordmark
  height, the shader's own density rule), ordered along a Hilbert curve and paired by rank, a cheap approximate
  optimal transport, so paths stay short and rarely cross; the smaller set is reused so every dot of both shapes
  takes part (a few split or merge on the way). About 1,600 pairs per letter, ~8,200 in all (8,170 measured), built once. While a
  letter changes, its still dots give way to these walking dots: each sets off at its own moment (`WALK_SPREAD` 0.55
  of the morph; half random, half a smooth function of place, so the motion ripples through the shape), eases along
  a slightly curved path (`WALK_CURVE` 0.18 of its length) with a little wander (`WALK_WOBBLE` 0.012 letter
  heights), dims mid-way (`WALK_DIP` 0.45) and brightens on arrival, at `WALK_TONE` 0.85 of the shape's tone. Dots
  keep their size and land back on the checkerboard lattice; in flight they may be anywhere. Over the first and last
  `WALK_EDGE` 0.1 of a morph the walking dots and the still ones hand over to each other dot by dot. They are drawn
  as single-cell points into their own texture, which the field pass reads, so the pointer and the focus underline
  stay on top. Nothing is scaled, so the outer letters cannot stretch. A morph takes `MORPH_MS` 1300–1700 ms (cubic
  in-out), shorter when it starts part-way, and can be retargeted mid-way without a jump. The same mechanism carries
  the autonomous morphs, the convergence and the curtain.
- The letters keep a random orientation (mirrored or not, per axis) as a static identity for the visit; it never
  animates. Marks are always upright.

## The curtain (hover)

The pointer parts the wordmark like fabric and reveals the marks beneath. The opening is irregular and alive: its
boundary is domain-warped by two octaves of slowly flowing noise (`CURTAIN_WARP` 0.35, never a circle or an ellipse),
so it keeps changing even under a still pointer. It has inertia and drag: it trails the pointer on a soft spring
(`CURTAIN_SPRING` ω 10, critically damped), stretches along the motion (`CURTAIN_STRETCH` 0.6) and widens across it
(`CURTAIN_WIDEN` 0.25) when the pointer moves fast, relaxing when it slows. Its size is `CURTAIN_R` 0.85 wordmark
heights. Its edge is a wide band (`CURTAIN_BAND` ± 0.5 of the radius) in which the morph switches sites at random, so
the letter dissolves into the mark dot by dot, never along a rim. Along that band the letter dots are gathered aside
(`CURTAIN_GATHER` 0.08 of the radius), shifted in slow undulating folds (`CURTAIN_FOLD` 0.05) and bunch up
(`CURTAIN_BUNCH` +35 % density), like cloth drawn back. Only the part of a letter under the opening shows its mark.
Behind the pointer the letters re-form the same ragged way, some dots lingering. The opening grows at `CURTAIN_OPEN`
10/s and fades at `CURTAIN_CLOSE` 3/s once the pointer leaves or rests for `IDLE_MS` 3 s; it works from halfway
through the loading build (`CURTAIN_FROM` 0.5); on touch it follows the finger while it is down. The revealed layer is
a texture in the same layout as the wordmark (`buildBrandTexture`), so another layer (an image, another SVG) can be
revealed the same way by building a different texture.

## Stand-alone: the 9-second cycle

Once nothing has touched the pointer for `IDLE_MS` (3 s), the letters run on their own in cycles of `CYCLE_MS` 9 s:

| ms into the cycle | what happens |
|---|---|
| 0–700 | hold: the pure wordmark (the previous cycle's pulse fading out) |
| 700–3600 (`SOLO_AT`) | each letter morphs into its mark at its own random moment |
| +1700–2600 (`SOLO_BACK_AFTER`) | with a 50 % chance (`SOLO_BACK`) a letter morphs back on its own |
| 6000–9600 (`PULSE_AT`, `PULSE_MS` 3600) | the convergence pulse: letters 30 % denser (`PULSE_L`), field 45 % thinner (`PULSE_THIN`) and gathered 5 % toward the wordmark (`PULSE_GATHER`), peaking at ~7.8 s |
| 6200–6700 (`CONVERGE_AT` + `CONVERGE_STAGGER`) | every letter still showing its mark morphs back; all letters again by ~8.4 s |
| 8400–9700 | hold: the pure wordmark around the cycle boundary |

Pointer input pauses the cycle: letters showing marks morph back (the curtain shows marks where the pointer is). The
cycle restarts from its hold 3 s after the last input, so it never jumps. A letter with keyboard focus is left alone.

## The field

- **Two passes.** *Field* runs at one fragment per dither cell (≈ 1/80 of the wordmark's height, 1–1.5 CSS px, never
  under 2 device px) into a texture; *compose* upscales it, each cell an exact square.
- **One material.** Dots are thresholded by one 64×64 blue-noise map; letters and marks sit on a checkerboard
  lattice (dense dots never fuse), the field is free blue noise (no grid, no repeating cluster). A letter or mark is
  only where those dots gather and burn paper-white; field dots are dimmer and cooler. A dot's intensity rises
  smoothly past its threshold (`DOT_FADE` 0.12, relative to the density) and is cut to zero below `DOT_FLOOR` 0.3.
- **True black.** Ink is `#000000` everywhere (shader, CSS `--ink`, `theme-color`). Measured on a full-screen
  frame read back from the field: 649 324 of 677 740 cells exactly 0, the dimmest lit dot 16/255, nothing between.
- **Calm sea and afterglow.** A slow swell displaces the field (0.9 cells) with ~14-cell ripples, per-dot twinkle and
  a slow brightness wave. Pointer motion and waves stir up an energy (0..1) that enlarges the swell where it happened
  and decays over `AFTERGLOW` 2.8 s.
- **The pointer.** On fine pointers (`(hover: hover) and (pointer: fine)`) the system cursor is hidden while the live
  field runs (`cursor: none` on the page and the letter links; never in the no-WebGL or reduced-motion versions, never
  on touch). The pointer is a dot with a gradient: a precise nucleus (`NUCLEUS_R` 4 CSS px) drawn exactly on the
  hotspot, every frame, with no smoothing, set off by a thin dark moat (`MOAT` 1.5 × its radius) so it stays legible
  over bright letters and marks; around it a soft round gradient of the same dots, dense and bright at the centre and
  thinning outward (`GRAD_R` 0.6 × `POINTER_R` 32 px, `GRAD_D` 0.95), breathing slowly (`BREATHE` 3 %). The gradient's
  centre follows on a spring (`POINTER_SPRING` ω 30, critically damped) but never trails by more than `POINTER_LAG`
  0.3 × 32 px. Over a letter-link the nucleus grows 25 % and the gradient tightens 15 % and brightens 30 %. The dot
  pushes the field out radially (`PUSH_AMT` 0.6, thinner inside `THIN` 0.6, compressed just outside `RING` 0.75),
  bends it sideways with speed (`DEFLECT` 0.35) and leaves a short wake (`WAKE` 0.5); stretch along motion is subtle
  (`STRETCH` 0.1). Nothing shows while the pointer is outside the window, or on touch without a finger down.
- **Fast motion.** No segment is ever drawn between samples; springs are sub-stepped at ≤ 8 ms with `dt` ≤ 50 ms;
  deflection, wake and energy respond to at most `MAX_SPEED` 2400 px/s.
- **Frame pacing.** Every display frame on desktop (60/90/120/144 Hz; all motion is time-based); ~30 fps on touch
  devices. Nothing is allocated per frame.
- **Waves.** A click or tap on the background (a click on a letter opens its link instead) sends one long, quiet
  ring through everything: speed 1.05 screen heights/s (past the farthest corner in about 2 s), life 2.6 s with a
  linear decay and a 0.2 s fade-in, half-width 0.1 screen heights, push 0.008 screen heights (`WAVE_PUSH`), density
  and brightness swell 0.4 (`WAVE_DENS`). No echo ring. Up to 6 overlap; none under reduced motion.
- **Size.** The wordmark is 39 vw wide (60 vw under 700 px), fixed in the exact centre.

## Loading: a particle build-up

The letters form the way the double-slit experiment's pattern does: particles land one by one at random and the
shape emerges only by accumulation (an analogy; there are no fringes). Every lattice site has its own arrival moment
(its blue-noise rank) and arrives at a rate set by its probability: a letter's core is likelier than its edges
(`BUILD_CORE` 0.65), unevenly (smooth noise, `BUILD_CLUMP` 0.4); both relax between 30 % and 90 % of the build so
every site arrives (`BUILD_GAIN` 1.15) and the build ends exactly in the resting wordmark. Early on a few scattered dots
land around the letters too (`BUILD_SCATTER` 0.3, following the field), fading as the letters win. Each dot flashes as
it lands and settles (`FLASH` 0.06 of the build); arrived letter dots stay. No text, no counter, no sweep.

The arrival rate follows Lucas's sketch (`BUILD_RATE`): segments on the normalised timeline, each `[from t, to t,
from v, to v, shape]` with v a share of the top rate and shape linear, a decay that is fast first and flattens
(1 − e^(−k·u)), or an abrupt jump eased over 1 % (≈ 80 ms, so nothing pops). The fill is its integral, tabulated once
(2048 steps) and normalised so the wordmark is complete exactly at the end.

| t | rate | shape | fill at the end of it |
|---|---|---|---|
| 0 → 20.7 % | 0 → 100 % | linear ramp (burst 1) | 20.9 % |
| 20.7 → 32 % | 100 → 19 % | decay, k 3 (the crash) | 30.4 % |
| 32 → 38.7 % | 19 → 47 % | linear (a smaller bump) | 34.9 % |
| 38.7 → 56.3 % | 47 → 22 % | decay, k 2.5 | 45.5 % |
| 56.3 → 57.3 % | 22 → 95 % | abrupt jump (burst 2) | 46.6 % |
| 57.3 → 76.6 % | 95 → 33 % | decay, k 2.5 | 67.0 % |
| 76.6 → 77.7 % | 33 → 95 % | abrupt jump (burst 3) | 68.4 % |
| 77.7 → 99.2 % | 95 → 51 % | slow decay, k 0.6 | 99.2 % |
| 99.2 → 100 % | 51 % | the last dots land; it stops | 100 % |

`BUILD_S` 8 s on a first visit (or with `?boot`); a returning visitor in the same session gets the same curve in
`BUILD_QUICK` 2.8 s; reduced motion shows the final frame at once. The letters are links throughout. `?debug`'s
`buildSamples()` returns v and fill at the control points (they match the table exactly).

## Fallbacks

- **No JS:** the SVG wordmark, each letter a working link.
- **No WebGL:** the same SVG links, system cursor kept. Letters keep their random orientation and run the same 9 s
  cycle; hovering a letter shows its mark. A change is a simple cross-dissolve between the SVG letter and the SVG mark
  (opacity only, single-tone marks).
- **`prefers-reduced-motion`:** one still frame in dots, system cursor kept: no build-up, no morphs, no curtain, no
  cycle, no pointer dot, no sea, no waves. Keyboard focus shows the letter's mark at once (with the underline).

## Brand marks

GitHub and Dribbble come from Simple Icons 16.36.0; LinkedIn from Simple Icons 13.21.0 (the last release that ships
it); Medium from Simple Icons 10.4.0 (the classic three-ellipse mark: the newer badge's cut-out M breaks up in dots). Simple Icons is CC0-1.0 (<https://simpleicons.org>). The envelope was drawn for this site. The marks are
trademarks of their owners and are used only to link to Lucas's own profiles. To add or change one, edit `brands.js`
(24 × 24 path data, optional `tones`) and `brandOf()` in `hero.js`.

## Knobs

Shader (`FIELD` / `PUSH` in `hero.js`): `DENS_L` 0.72 · `DENS_WAVE` 0.25 · `DENS_E` 0.3 · `EDGE_SOFT` 3.6 cells ·
`EDGE_HOVER` 0.3 · `EDGE_NOISE` 2.2 · `TONE_DENS` 0.3 · `TONE_BRIGHT` 0.5 · `WALK_SPREAD` 0.55 · `WALK_CURVE` 0.18 · `WALK_WOBBLE` 0.012 · `WALK_DIP` 0.45 · `WALK_TONE` 0.85 · `WALK_EDGE` 0.1 · `CURTAIN_BAND` 0.5 · `CURTAIN_WARP` 0.35 ·
`CURTAIN_STRETCH` 0.6 · `CURTAIN_WIDEN` 0.25 · `CURTAIN_GATHER` 0.08 · `CURTAIN_FOLD` 0.05 · `CURTAIN_BUNCH` 0.35 ·
`PULSE_L` 0.3 · `PULSE_THIN` 0.45 · `PULSE_GATHER` 0.05 · `BUILD_CORE` 0.65 · `BUILD_CLUMP` 0.4 · `BUILD_SCATTER` 0.3 · `BUILD_GAIN` 1.15 ·
`FLASH` 0.06 · `DOT_FADE` 0.12 · `DOT_FLOOR` 0.3 · `TONE_L` 0.97 · `TWINKLE` 0.3 · `FIELD_TINT` · `SEA_AMP` 0.9 ·
`SEA_STIR` 4.0 · `SEA_GLOBAL` 1.2 · `SEA_SCALE` 0.3 · `SEA_SPEED` 0.05 · `SEA_RIPPLE` 0.07 · `GRAD_R` 0.6 · `GRAD_D`
0.95 · `MOAT` 1.5 · `PUSH_AMT` 0.6 · `DEFLECT` 0.35 · `RING` 0.75 · `THIN` 0.6 · `WAKE` 0.5 · `STRETCH` 0.1 ·
`BREATHE` 0.03 · `WAVE_SPEED` 1.05 · `WAVE_WIDTH` 0.1 · `WAVE_PUSH` 0.008 · `WAVE_DENS` 0.4.
JS (top of `hero.js`): `POINTER_R` 32 px · `NUCLEUS_R` 4 px · `POINTER_SPRING` [30, 1] · `POINTER_LAG` 0.3 ·
`AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s · `CURTAIN_R` 0.85 · `CURTAIN_SPRING` [10, 1] · `CURTAIN_OPEN` 10/s ·
`CURTAIN_CLOSE` 3/s · `IDLE_MS` 3000 · `MORPH_MS` 1300–1700 · `CYCLE_MS` 9000 · `SOLO_AT` 700–3600 · `SOLO_BACK` 0.5 ·
`SOLO_BACK_AFTER` 1700–2600 · `CONVERGE_AT` 6200 · `CONVERGE_STAGGER` 500 · `PULSE_AT` 6000 · `PULSE_MS` 3600 ·
`WAVE_LIFE` 2.6 s · `MAX_WAVES` 6 · `BUILD_RATE` (above) · `BUILD_S` 8 s · `BUILD_QUICK` 2.8 s · `CURTAIN_FROM` 0.5 · `BRAND_H` 9.5
units · `BRAND_ROUND` [4, 3] texels · `ROUND_OPEN` / `ROUND_CLOSE` 17 / 9 texels. Ink `#000000`, paper `#f0efea`.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
