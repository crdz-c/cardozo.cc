# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen: the **CRDZC** wordmark, centred, drawn as dots in a single dithered dot field. **Each letter is a link**,
and under each letter lies the mark of its link (envelope, LinkedIn, Dribbble, Medium, GitHub). The pointer opens the
wordmark like a curtain and reveals the marks beneath it; left alone, the letters turn into their marks on their own
and every 9 seconds everything converges back into CRDZC. A letter's own change melts one shape into the other;
under the pointer the dots part like oil on water. The pointer is drawn as a dot with a gradient (the system cursor is hidden); a click
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
- A letter's state is one number, 0 (letter) … 1 (mark). **A letter's own change is a melt**: the two shapes' signed
  distances are blended, so one shape flows into the other as a single coherent mass, with no particles and no
  fragments. The moment shifts a little across the letter along a smooth noise (`MELT_RIPPLE` 0.25 at
  `MELT_NOISE` 1.4 per letter height), so the change ripples through it; space bends gently mid-way along a slow flow
  field (`MELT_WARP` 0.06 letter heights); intensities dip and rise (`MELT_DIP` 0.35). It is continuous in time and
  space, so every display frame shows a slightly different stage. Nothing is scaled, so the outer letters cannot
  stretch. A change takes `MORPH_MS` 1000–1400 ms (cubic in-out), shorter when it starts part-way, and can be
  retargeted mid-way without a jump. The same melt carries the autonomous changes and the 9 s convergence.
- The letters keep a random orientation (mirrored or not, per axis) as a static identity for the visit; it never
  animates. Marks are always upright.

## The curtain (hover)

The pointer opens the wordmark like a curtain and reveals the marks beneath. The curtain is a soft disc around the
pointer (`CURTAIN_R` 0.85 wordmark heights), its edge feathered over `CURTAIN_FEATHER` 0.35 of the radius and gently,
slowly wobbled by noise (`CURTAIN_WOBBLE` 0.18). It rides a spring (`CURTAIN_SPRING` ω 16, critically damped), so it
trails the pointer a little and the letters re-form behind it. Under it, each lattice site switches from the letter to
the mark at its own moment (its blue-noise rank mixed `MORPH_RIPPLE` 0.5 with a smooth noise at `MORPH_NOISE` 2.2),
taking `MORPH_SOFT` 0.08 of the reveal, drifting up to `MORPH_DRIFT` 0.05 letter heights toward the new shape and
dimming by `MORPH_DIP` 0.6 while it does. Only the part of a letter under it shows its mark. It opens at
`CURTAIN_OPEN` 10/s and closes at `CURTAIN_CLOSE` 3/s, once the pointer leaves or rests for `IDLE_MS` 3 s; it works
from halfway through the loading build (`CURTAIN_FROM` 0.5); on touch it follows the finger while it is down.

**Oil on water.** On top of that, the surface film of dots (the letters and the field around) is pushed radially
away from the curtain's centre along smooth flow lines, leaving a clean opening where the mark reads clearly. Material
at radius x moves to x + D(x), with D = `REPEL` 0.5 × radius × e^(−(x / `REPEL_W` 0.9 × radius)²); the shader inverts
that per cell (four fixed-point steps), so the opening is empty, its edge softened over `REPEL_SOFT` 0.12 of the
radius, and the film is compressed just outside it into a soft, denser rim (up to `REPEL_RIM` 1.6×), like the bead at
the edge of oil. The map never folds (the push stays below the rate at which it decays), so nothing breaks into loose
fragments. It is viscous: it opens on a slightly underdamped spring (`REPEL_OPEN` ω 7, ζ 0.8) and flows back on a
slower one (`REPEL_CLOSE` ω 3.2, ζ 1), and it rides the curtain's lagging centre. The marks beneath do not move.

The revealed layer is a texture in the same layout as the wordmark (`buildBrandTexture`), so another layer (an image,
another SVG) can be revealed the same way by building a different texture.

## Stand-alone: the 9-second cycle

Once nothing has touched the pointer for `IDLE_MS` (3 s), the letters run on their own in cycles of `CYCLE_MS` 9 s:

| ms into the cycle | what happens |
|---|---|
| 0–700 | hold: the pure wordmark (the previous cycle's pulse fading out) |
| 700–3600 (`SOLO_AT`) | each letter morphs into its mark at its own random moment |
| +1700–2600 (`SOLO_BACK_AFTER`) | with a 50 % chance (`SOLO_BACK`) a letter morphs back on its own |
| 6000–9600 (`PULSE_AT`, `PULSE_MS` 3600) | the convergence pulse: letters 30 % denser (`PULSE_L`), field 45 % thinner (`PULSE_THIN`) and gathered 5 % toward the wordmark (`PULSE_GATHER`), peaking at ~7.8 s |
| 6200–6700 (`CONVERGE_AT` + `CONVERGE_STAGGER`) | every letter still showing its mark melts back; all letters again by ~8.1 s |
| 8100–9700 | hold: the pure wordmark around the cycle boundary |

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

## Loading: the letters fill with dots

Only the letters load. Every lattice site inside them has its own arrival moment (its blue-noise rank) and lands when
the fill passes it (`BUILD_GAIN` 1.03), so dots land at random all over the five letters, at the rate of the curve
below, each flashing as it lands and settling (`FLASH` 0.06 of the build). The letters are dimmer until the last
quarter of the build. The field around is simply there from the first frame, at its normal quiet density, and
nothing in it reacts to the build. No text, no counter, no sweep, no stray dots outside the letters.

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
`EDGE_HOVER` 0.3 · `EDGE_NOISE` 2.2 · `TONE_DENS` 0.3 · `TONE_BRIGHT` 0.5 · `MORPH_RIPPLE` 0.5 · `MORPH_NOISE` 2.2 · `MORPH_SOFT` 0.08 · `MORPH_DRIFT` 0.05 · `MORPH_DIP` 0.6 ·
`MELT_RIPPLE` 0.25 · `MELT_NOISE` 1.4 · `MELT_WARP` 0.06 · `MELT_DIP` 0.35 · `CURTAIN_FEATHER` 0.35 · `CURTAIN_WOBBLE` 0.18 ·
`REPEL` 0.5 · `REPEL_W` 0.9 · `REPEL_SOFT` 0.12 · `REPEL_RIM` 1.6 ·
`PULSE_L` 0.3 · `PULSE_THIN` 0.45 · `PULSE_GATHER` 0.05 · `BUILD_GAIN` 1.03 ·
`FLASH` 0.06 · `DOT_FADE` 0.12 · `DOT_FLOOR` 0.3 · `TONE_L` 0.97 · `TWINKLE` 0.3 · `FIELD_TINT` · `SEA_AMP` 0.9 ·
`SEA_STIR` 4.0 · `SEA_GLOBAL` 1.2 · `SEA_SCALE` 0.3 · `SEA_SPEED` 0.05 · `SEA_RIPPLE` 0.07 · `GRAD_R` 0.6 · `GRAD_D`
0.95 · `MOAT` 1.5 · `PUSH_AMT` 0.6 · `DEFLECT` 0.35 · `RING` 0.75 · `THIN` 0.6 · `WAKE` 0.5 · `STRETCH` 0.1 ·
`BREATHE` 0.03 · `WAVE_SPEED` 1.05 · `WAVE_WIDTH` 0.1 · `WAVE_PUSH` 0.008 · `WAVE_DENS` 0.4.
JS (top of `hero.js`): `POINTER_R` 32 px · `NUCLEUS_R` 4 px · `POINTER_SPRING` [30, 1] · `POINTER_LAG` 0.3 ·
`AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s · `CURTAIN_R` 0.85 · `CURTAIN_SPRING` [16, 1] · `REPEL_OPEN` [7, 0.8] · `REPEL_CLOSE` [3.2, 1] · `CURTAIN_OPEN` 10/s ·
`CURTAIN_CLOSE` 3/s · `IDLE_MS` 3000 · `MORPH_MS` 1000–1400 · `CYCLE_MS` 9000 · `SOLO_AT` 700–3600 · `SOLO_BACK` 0.5 ·
`SOLO_BACK_AFTER` 1700–2600 · `CONVERGE_AT` 6200 · `CONVERGE_STAGGER` 500 · `PULSE_AT` 6000 · `PULSE_MS` 3600 ·
`WAVE_LIFE` 2.6 s · `MAX_WAVES` 6 · `BUILD_RATE` (above) · `BUILD_S` 8 s · `BUILD_QUICK` 2.8 s · `CURTAIN_FROM` 0.5 · `BRAND_H` 9.5
units · `BRAND_ROUND` [4, 3] texels · `ROUND_OPEN` / `ROUND_CLOSE` 17 / 9 texels. Ink `#000000`, paper `#f0efea`.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
