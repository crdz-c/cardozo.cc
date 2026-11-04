# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now. The hero is **one canvas of dots**: the CRDZC wordmark and the links stacked under it are
rendered *into* a single dithered dot field, made of the same square dots. The pointer is a small "electron" that
pushes the field around; a letter flips when the pointer enters it; a click on the background sends a wave across
the screen. No build step, no dependencies (native ES modules). This repo is where the full site will live later.

```
index.html   the page: real DOM for layout, links, focus and screen readers; the wordmark is inline SVG
style.css    layout; under .gl the links stay in layout but are visually transparent (the shader draws them)
hero.js      wordmark texture, shaders, electron, flips, waves, calm sea and afterglow, boot
elements.js  the scene-element registry and the UI-mask rasteriser (text, boxes, SVG, images)
raster.js    exact distance transform, corner rounding, blue-noise threshold map
fonts/       Big Shoulders Display (links, boot counter) + Geist Mono (boot console), self-hosted, OFL
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.
`?debug` exposes `window.__hero` (live state, flips, and `crop(x, y, w, h, zoom)`, which returns the field as
rendered, one pixel per cell) for scripted checks.

## Layout

The wordmark is 39 vw wide (60 vw under 700 px), fixed in the exact centre. The six links hang under it, centred,
one per line (`.dock`: `top: 50% + half the wordmark's height + clamp(22px, 4.5vh, 48px)`). No header, no
container, no dividers, no arrows; screen readers get "opens in a new tab". Checked at 1788×986, 1545×986,
1440×700, 768×1024 and 375×812: no overlap, no scroll.

## Architecture: one canvas of dots

- **Two passes.** *Field* runs at one fragment per dither cell (≈ 1/80 of the wordmark's height, 1–1.5 CSS px,
  never under 2 device px) into a texture: the dot field, the wordmark, the electron, the waves and the UI.
  *Compose* upscales it to device pixels, each cell an exact CELL × CELL square.
- **One material.** Field dots sit on one checkerboard lattice (they touch at most at a corner) and are
  thresholded by one 64×64 blue-noise map. A letter is only a region where those dots are denser and paper-white;
  field dots are dimmer and a touch cooler. Letter edges are a wide density ramp roughened by noise — no fill,
  no outline, no halo — crisper right around the electron.
- **Field.** Density, not dot size, carries the gradient: a quadtree of 8 / 4 / 1-cell blocks subdivides where a
  noise-warped field (dense around the wordmark) beats a jittered threshold, so the edges of the screen are a quiet
  dot grid and the centre is fine grain. Forced fine around the wordmark, the electron and wave fronts.
- **Wordmark.** The SVG paths are rasterised once, corners rounded (opening by a 17-texel disc ≈ 4.9% of the letter
  height, closing by 9 ≈ 2.6%, on an exact Euclidean distance transform), and stored as coverage + inside distance
  + outside distance. A CPU copy of the signed distance drives the pointer's enter test.
- **Calm sea and afterglow.** The field is never quite still: a slow, low-frequency swell displaces its density
  (0.9 cells), carrying ~14-cell ripples of dots, on top of per-dot twinkle and a slow brightness wave. A moving
  electron or a wave stirs up an *energy* (0..1) that enlarges and quickens the swell — most around where it
  happened — and decays with a 2.8 s time constant. The letters drift only slightly while it lasts; the UI never.

## Type

The links are set in **Big Shoulders Display 700, uppercase**, 15 px (14 px on phones), tracked 0.08 em, and drawn
by sampling the font's own coverage once per field cell (two taps across the cell for a little extra weight; a
cell lights above 42% coverage). So the words are made of the field's square cells: crisp, steady, no blur.

Why this face: it is the boldest condensed geometric grotesque we ship (OFL, self-hosted). Its round bowls and
straight, square-cut strokes sit closest to the wordmark (heavy geometric grotesque, round C and D, straight Z
and R leg). Uppercase matches the wordmark. The vendored file stops at weight 700, so the Black (800–900) cut is
not available. Anton, Bebas Neue, Barlow Condensed, Archivo ExtraCondensed, Saira ExtraCondensed, League Gothic
and Oswald were not compared: they are not on this machine, and adding one means downloading its OFL file.
Swapping the face is one `@font-face` and one `font-family` in `style.css`; the pipeline draws whatever font the DOM uses.

`TEXT_LATTICE` chooses between every cell (default, 0: crisp words at small sizes) and the field's checkerboard (1:
lighter, more "dotted"). Hover always uses every cell and full brightness.

## The element pipeline

`elements.js` keeps a registry of everything rendered into the dots. **Layout stays in the DOM**: each element
points at a real node; on resize and font load the registry is rasterised into one screen-sized *UI mask*
(device pixels) that the field pass samples once per cell:

| channel | meaning |
|---|---|
| R | text: the node's own web font, glyph coverage × density |
| G | 0.25 = an element's area (the field quiets under it); above that a shape drawn as lattice dots at density (G − 0.25)/0.75 |
| B | image tone → dot density |

The electron and the waves move everything in the mask: text in whole even-cell steps (it never breaks up), softened
inside the hovered word so it stays readable. Under `.gl` the DOM versions are transparent but keep working (click,
keyboard, screen readers); keyboard focus is drawn as a dotted underline. Without WebGL the normal DOM shows.

### Adding an element

Register it in `hero.js` next to the links; the node must exist in the DOM (it can be visually transparent under `.gl`).

```js
// text: any element with text; font, size, letter-spacing and wrapping come from its computed style
elements.add({ id: "role", kind: "text", node: document.querySelector(".role"), density: 0.8 });

// a box: an area (quiets the field under it) and/or a dotted outline; hover: true makes it light up under the pointer
elements.add({ id: "card", kind: "box", node: card, area: true, outline: true, density: 0.6, hover: true });

// an SVG: its <path>s are filled, scaled from the viewBox to the node's box
elements.add({ id: "icon", kind: "svg", node: document.querySelector("svg.icon") });

// an image: its luminance becomes dot density inside the node's box (same-origin only, no external requests)
elements.add({ id: "photo", kind: "image", node: document.querySelector(".photo"), src: "img/photo.jpg", density: 0.9 });
```

`kind: "wordmark"` is special (its own texture and flips).

## Interaction

- **The electron.** The pointer (or a finger while touching) is a small, precise focus on a critically damped
  spring (ω 26): radius 32 CSS px, a knot of bright dots at its core, the field pushed outward (thinned inside,
  bunched in a ring at the rim), a sideways deflection relative to its motion (like a charge bending field lines)
  and a short wake. No idle light: with no pointer the page only breathes.
- **Caps for fast motion.** The electron is a single point on a spring (no segment is ever drawn between pointer
  samples); springs are sub-stepped at ≤ 8 ms and `dt` is capped at 50 ms; the deflection, the wake and the stirred
  energy respond to at most `MAX_SPEED` (2400 CSS px/s); energy is capped at 1 and decays over `AFTERGLOW`; waves
  live `WAVE_LIFE`. A fast flick returns to the calm baseline within ~3 s with nothing left behind.
- **Flips.** Every letter starts in a **random orientation** on each load. A letter flips when the pointer
  **enters** its shape (or a finger taps it), horizontally or vertically at random, around its own centre:
  760–980 ms, quart in-out, dimming and loosening while edge-on. It can flip again only after the pointer has left
  it (`ENTER_IN` 0.02 h inside the edge to trigger, `ENTER_OUT` 0.08 h outside to re-arm) and a `FLIP_COOLDOWN`
  of 250 ms after the flip ends. `HORIZONTAL_BIAS` sets the odds per letter (C and D look the same flipped vertically).
- **Links.** Hovering a word draws it with every cell at full brightness; the real `<a>` handles the click and the
  cursor; keyboard focus draws a dotted underline.
- **Waves.** A click or tap on the background (not a link, not a letter) sends a ring through the whole field —
  letters and links included — at 0.95 screen heights/s for 1.9 s; up to four overlap.
- **Boot** (~3.5 s, first visit per session): console, counter, progress line; the field fills in, the letters
  dissolve in, then the links dissolve in. Returning visitors get only the entrance.
- **Degrades**: no JS → static page with the SVG wordmark and the links. No WebGL → SVG + DOM links, same random
  orientations, letters flip when the pointer enters their column. `prefers-reduced-motion` → one still frame
  (still in dots), redrawn for hover and focus; no boot, flips, electron motion, sea or waves.

## Knobs

Shader (top of `FIELD` / `PUSH` in `hero.js`): `DENS_L` 0.72 letter density · `DENS_WAVE` 0.25 · `DENS_E` 0.3 ·
`EDGE_SOFT` 3.6 cells · `EDGE_HOVER` 0.3 · `EDGE_NOISE` 2.2 · `TONE_L` 0.97 · `TWINKLE` 0.3 · `FIELD_TINT` ·
`SEA_AMP` 0.9 · `SEA_STIR` 4.0 · `SEA_GLOBAL` 1.2 · `SEA_SCALE` 0.3 · `SEA_SPEED` 0.05 · `SEA_RIPPLE` 0.07 · `CORE` 0.32 ·
`PUSH_AMT` 0.6 · `THIN` 0.6 · `DEFLECT` 0.35 · `RING` 0.75 · `WAKE` 0.5 · `WAVE_SPEED` 0.95 · `WAVE_WIDTH` 0.03 ·
`WAVE_PUSH` 0.007 · `WAVE_DENS` 0.55 · `TEXT_CUT` 0.42 · `TEXT_LATTICE` 0 · `TEXT_TONE` 0.86 · `LINE_TONE` 0.5 ·
`AREA_QUIET` 0.25 · `IMG_DENS` 0.9.
JS (top of `hero.js`): `ELECTRON_R` 32 px · `ELECTRON_SPRING` [26, 1] · `AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s ·
`ENTER_IN` 0.02 · `ENTER_OUT` 0.08 · `FLIP_COOLDOWN` 250 ms · `WAVE_LIFE` 1.9 s · `HORIZONTAL_BIAS` per letter.
Ink #060606, paper #f0efea.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
