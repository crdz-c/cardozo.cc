# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen: the **CRDZC** wordmark, centred, drawn as dots in a single dithered dot field. **Each letter is a link.**
Every few seconds a letter flips on its own and its dots regather into the mark of its link (envelope, LinkedIn,
Dribbble, Medium, GitHub), then flip back. The pointer is a small "electron" that pushes the dots around; a click
on the background sends a slow ripple across the screen. No build step, no dependencies (native ES modules).

```
index.html   the page: the wordmark as inline SVG, each letter an <a> (the real links, focus, screen readers)
style.css    layout; under .gl the SVG stays in place but transparent (the shader draws it)
hero.js      letter/brand textures, the dot-field shader, flips and faces, electron, waves, sea, boot
brands.js    the five brand marks as SVG path data
raster.js    exact distance transform, corner rounding, blue-noise threshold map
fonts/       Big Shoulders Display (boot counter) + Geist Mono (boot console), self-hosted, OFL
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.
`?debug` exposes `window.__hero`: live `state`, `flips`, `letters()` (each letter's face, mirror, whether it is
flipping and ms to its next flip) and `crop(x, y, w, h, zoom)` (the field as rendered, one pixel per cell).

## Letters are links

| letter | link | brand face |
|---|---|---|
| C | mailto:lucas@cardozo.cc | envelope |
| R | linkedin.com/in/cardozolucas | LinkedIn |
| D | dribbble.com/cardozoconc | Dribbble |
| Z | medium.com/@cardozoconc | Medium |
| C | github.com/crdz-c | GitHub |

The links live in `index.html`: each letter's `<g class="lt">` sits inside an SVG `<a>` with a transparent hit box
over its column, so the whole column is clickable whatever face is showing. Web links open in a new tab
(`rel="me noopener"`); each has an `aria-label`. The brand face is read from the link's URL, so **remapping is just
reordering the `href`s** in `index.html`. Under `.gl` the SVG is `opacity: 0`, not hidden: hit-testing, the pointer
cursor, keyboard focus (Tab, Enter) and screen readers keep working. Keyboard focus is drawn as a dotted underline
in the dots. Hover has no special effect: the electron does what it does everywhere.

## Flips and faces

- Every letter has two faces sharing one texture layout: the letter (the wordmark's own paths, corners rounded) and
  its brand mark (fitted in a 14 × 14 unit square centred on the letter, lightly rounded). Both are stored as
  coverage + inside distance + outside distance, so a brand mark is made of the same dots, with the same soft edge.
- Each letter flips **on its own timer**: the first flip after `FLIP_FIRST` (1.5–5 s, so they never flip together),
  then every `FLIP_EVERY` (4–6 s). A flip takes `FLIP_DUR` (760–980 ms, quart in-out), horizontally or vertically at
  random, around the letter's centre (scale through zero).
- At edge-on the face swaps. Around the swap the shape thins out (`MORPH_THIN` 0.7) and a cloud of dots in flight
  fills the letter's box (`MORPH_CLOUD` 0.55, re-rolled a dozen times a second): the dots scatter and regather into the
  other shape; same dots, no cross-fade.
- Brand marks are always upright. The letter face keeps a mirror state: random on every load, and each time the letter
  comes back the flipped axis toggles it, so the wordmark's orientations keep evolving. `HORIZONTAL_BIAS` sets the odds
  per letter (C and D look the same flipped vertically).
- A flip that comes due while its letter is hovered or focused waits (`POSTPONE` 700 ms, re-checked), so a click never
  lands on a moving target.

## The field

- **Two passes.** *Field* runs at one fragment per dither cell (≈ 1/80 of the wordmark's height, 1–1.5 CSS px, never
  under 2 device px) into a texture; *compose* upscales it, each cell an exact square.
- **One material.** Dots sit on one checkerboard lattice and are thresholded by one 64×64 blue-noise map. A letter
  (or brand mark) is only where those dots gather and burn paper-white; field dots are dimmer and cooler. Edges are a
  wide density ramp roughened by noise, crisper right around the electron. No fill, outline or halo.
- **Density, not dot size,** carries the gradient: a quadtree of 8 / 4 / 1-cell blocks, fine around the wordmark,
  the electron and wave fronts, a quiet grid toward the edges.
- **Calm sea and afterglow.** A slow swell displaces the field's density (0.9 cells), carrying ~14-cell ripples, on top
  of per-dot twinkle and a slow brightness wave. A moving electron or a wave stirs up an energy (0..1) that enlarges
  the swell around where it happened and decays over `AFTERGLOW` (2.8 s). The letters drift only slightly meanwhile.
- **The electron.** The pointer (or a finger while touching) on a critically damped spring (ω 26), radius 32 CSS px:
  a bright core, the field pushed out (thinner inside, bunched at the rim), a sideways deflection with speed and a
  short wake. Caps for fast motion: no segment is ever drawn between samples; springs are sub-stepped at ≤ 8 ms with
  `dt` ≤ 50 ms; deflection, wake and energy respond to at most `MAX_SPEED` (2400 px/s).
- **Waves.** A click or tap on the background (a click on a letter opens its link instead) sends a ripple through
  everything: speed 0.55 screen heights/s (it passes the farthest corner), life 4.6 s with a slow decay
  ((1 − age/life)^1.4, 0.25 s fade-in), ring half-width 0.06 screen heights, push 0.016 screen heights, density swell
  0.8, two trailing echoes (0.45 and 0.2, 2.6 half-widths apart, alternating push like water). Up to 6 overlap.
- **Boot** (~3.5 s, first visit per session): console, counter, progress line; the field fills in and the letters
  dissolve in. Returning visitors get only the entrance.
- **Size.** The wordmark is 39 vw wide (60 vw under 700 px), fixed in the exact centre.

## Fallbacks

- **No JS:** the SVG wordmark, each letter a working link.
- **No WebGL:** the same SVG links; the letters keep their random mirror states and flip on the same timers, swapping
  to the brand mark (drawn as an SVG path) and back.
- **`prefers-reduced-motion`:** one still frame in dots (redrawn for keyboard focus): no boot, no flips, no
  electron motion, no sea, no waves.

## Brand marks

GitHub, Medium and Dribbble come from Simple Icons 16.36.0; LinkedIn from Simple Icons 13.21.0 (the last release that
ships it). Simple Icons is CC0-1.0 (<https://simpleicons.org>). The envelope was drawn for this site. The marks are
trademarks of their owners and are used only to link to Lucas's own profiles. To add or change one, edit `brands.js`
(24 × 24 path data) and `brandOf()` in `hero.js`.

## Knobs

Shader (`FIELD` / `PUSH` in `hero.js`): `DENS_L` 0.72 · `DENS_WAVE` 0.25 · `DENS_E` 0.3 · `EDGE_SOFT` 3.6 cells ·
`EDGE_HOVER` 0.3 · `EDGE_NOISE` 2.2 · `TONE_L` 0.97 · `TWINKLE` 0.3 · `FIELD_TINT` · `MORPH_THIN` 0.7 · `MORPH_CLOUD` 0.55 ·
`SEA_AMP` 0.9 · `SEA_STIR` 4.0 · `SEA_GLOBAL` 1.2 · `SEA_SCALE` 0.3 · `SEA_SPEED` 0.05 · `SEA_RIPPLE` 0.07 · `CORE` 0.32 ·
`PUSH_AMT` 0.6 · `THIN` 0.6 · `DEFLECT` 0.35 · `RING` 0.75 · `WAKE` 0.5 · `WAVE_SPEED` 0.55 · `WAVE_WIDTH` 0.06 ·
`WAVE_PUSH` 0.016 · `WAVE_DENS` 0.8 · `WAVE_ECHO` 0.45 · `WAVE_ECHO2` 0.2 · `WAVE_GAP` 2.6.
JS (top of `hero.js`): `ELECTRON_R` 32 px · `ELECTRON_SPRING` [26, 1] · `AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s ·
`FLIP_EVERY` 4–6 s · `FLIP_FIRST` 1.5–5 s · `FLIP_DUR` 760–980 ms · `POSTPONE` 700 ms · `WAVE_LIFE` 4.6 s ·
`MAX_WAVES` 6 · `BRAND_SIZE` 14 units · `BRAND_ROUND` [4, 3] texels · `ROUND_OPEN` / `ROUND_CLOSE` 17 / 9 texels ·
`HORIZONTAL_BIAS` per letter. Ink #060606, paper #f0efea.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
