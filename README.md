# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now. The hero is **one canvas of dots**: the CRDZC wordmark, the labels and the link container
are all rendered *into* a single dithered dot field, made of the same dots. The pointer is a small "electron"
that pushes the field around and sticks to the letters; a click on the background sends a wave across it.
No build step, no dependencies (native ES modules). This repo is where the full site will live later.

```
index.html   the page: real DOM for layout, links, focus and screen readers; the wordmark is inline SVG
style.css    layout; under .gl the labels and links stay in layout but are visually transparent
hero.js      wordmark texture, shaders, electron + sticky state machine, waves, boot
elements.js  the scene-element registry and the UI-mask rasteriser (text, boxes, SVG, images)
raster.js    exact distance transform, corner rounding, blue-noise threshold map
fonts/       Big Shoulders Display (boot counter) + Geist Mono (labels), self-hosted, OFL
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.

## Architecture: one canvas of dots

- **Two passes.** *Field* runs at one fragment per dither cell (≈ 1/80 of the wordmark's height, 1–1.5 CSS px,
  never under 2 device px) into a texture: the dot field, the wordmark, the electron, the waves, the bubble, and
  UI shapes as dots on the lattice. *Compose* runs at device pixels: it upscales the cells (each an exact
  CELL × CELL square) and dithers UI **text** at device resolution, so 10–11 px type stays legible while still
  being dots (finer ones than the field's — a deliberate trade-off).
- **One material.** Every dot sits on one checkerboard lattice (dots touch at most at a corner) and is
  thresholded by one 64×64 blue-noise map. A letter is only a region where those dots are denser and paper-white;
  field dots are dimmer and a touch cooler. Letter edges are a wide density ramp roughened by noise — no fill,
  no outline, no halo — and the ramp gets crisper right around the electron.
- **Field.** Density, not dot size, carries the gradient: a quadtree of 8 / 4 / 1-cell blocks subdivides where a
  noise-warped field (dense around the wordmark) beats a jittered threshold, so the edges of the screen are a quiet
  dot grid and the centre is fine grain. It is forced fine around the wordmark, the electron and wave fronts.
- **Wordmark.** The SVG paths are rasterised once, corners rounded (opening by a 17-texel disc ≈ 4.9% of the letter
  height, closing by 9 ≈ 2.6%, on an exact Euclidean distance transform), and stored as coverage + inside distance
  + outside distance (170 texels, enough for the bubble). A CPU copy of the signed distance drives the capture logic.
  The wordmark is 39 vw wide (60 vw under 700 px), fixed in the centre; letters only move when they flip.

## The element pipeline

`elements.js` keeps a registry of everything rendered into the dots. **Layout stays in the DOM**: each element
points at a real node; on resize and font load the registry is rasterised into one screen-sized *UI mask*
(device pixels) that both passes read:

| channel | meaning |
|---|---|
| R | text: glyph coverage × density, dithered at device pixels in *compose* |
| G | 0.25 = an element's area (the field quiets under it); above that a shape drawn as lattice dots at density (G − 0.25)/0.75 |
| B | image tone → dot density |

Hover, focus and the electron's push work on everything in the mask. Under `.gl` the DOM versions are transparent
but keep working (click, keyboard, screen readers); the focus ring is drawn as a dotted ring. Without WebGL the
normal DOM shows.

### Adding an element

Register it in `hero.js` next to the others; the node must exist in the DOM (it can be visually transparent under `.gl`).

```js
// text: any element with text; font, size, letter-spacing and wrapping come from its computed style
elements.add({ id: "role", kind: "text", node: document.querySelector(".role"), density: 0.8 });

// a box: area (quiets the field under it) and/or a dotted outline; hover: true makes it light up under the pointer
elements.add({ id: "card", kind: "box", node: card, area: true, outline: true, density: 0.6, hover: true });

// an SVG: its <path>s are filled, scaled from the viewBox to the node's box
elements.add({ id: "icon", kind: "svg", node: document.querySelector("svg.icon") });

// an image: its luminance becomes dot density inside the node's box (same-origin only, no external requests)
elements.add({ id: "photo", kind: "image", node: document.querySelector(".photo"), src: "img/photo.jpg", density: 0.9 });
```

`kind: "wordmark"` is special (its own texture, flips, stickiness). Only the wordmark is `sticky` for now.

## Interaction

- **The electron.** The pointer (or a finger while touching) is a small, precise focus on a critically damped
  spring (ω 34): radius 22 CSS px, a knot of bright dots at its core, a ring of compressed dots where it pushes the
  field outward, a sideways deflection relative to its motion (like a charge bending field lines) and a short wake.
  No idle light: with no pointer the page only twinkles and breathes.
- **Sticky letters — state machine** (`updateSticky` in `hero.js`; distances in wordmark heights h):
  - **FREE → STUCK(i)** when the electron comes within `ENTER` (0.2 h) of letter *i*'s edge and *i* is armed.
    Capturing flips the letter (horizontal or vertical at random).
  - **STUCK(i)**: a bubble grows out of *i* toward the electron — a smooth union of the letter's distance field with
    a small blob (radius 0.09 h, neck 0.6 h) on a gooey spring (ω 15, ζ 0.55). The blob's anchor stays at most
    `MAX_PULL` (0.42 h) from the letter.
    - pulled past `MAX_PULL` with the electron within `ENTER` of another letter *j* → **STUCK(j)** (hand-over, *j* flips);
    - pulled past `MAX_PULL` with no letter near → **FREE** (the neck snaps back);
    - **direction change**: the electron travels `TURN_BACK` (0.14 h) back against the horizontal direction it was
      captured in → **FREE**; it then captures the next letter it reaches in the new direction;
    - the pointer leaves / the finger lifts → **FREE**.
  - A released letter re-arms only once the electron is `REARM` × `ENTER` away from it (hysteresis), so it cannot
    re-capture and flip again on the spot. Capture uses each letter's full resting shape, even mid-flip.
- **Links.** Hovering a cell fills it with dots and brightens its text; the real `<a>` handles the click and the
  cursor; keyboard focus draws a dotted ring.
- **Waves.** A click or tap on the background (not a link, not inside a letter) sends a ring through the whole
  field — letters and UI included — at 0.95 screen heights/s for 1.9 s; up to four overlap.
- **Boot** (~3.5 s, first visit per session): console, counter, progress line; the field fills in, the letters
  dissolve in, then the UI dissolves in through the dither. Returning visitors get only the entrance.
- **Degrades**: no JS → static page with the SVG wordmark. No WebGL → SVG + DOM links, same random orientations,
  letters flip when the pointer enters them. `prefers-reduced-motion` → one still frame (still in dots), redrawn
  for hover and focus; no boot, flips, electron motion or waves.

## Knobs

Shader (top of `FIELD` / `COMPOSE` / `PUSH` in `hero.js`): `DENS_L` 0.72 letter density · `DENS_WAVE` 0.25 ·
`DENS_E` 0.3 extra density near the electron · `EDGE_SOFT` 3.6 cells edge ramp · `EDGE_HOVER` 0.3 (crisper near
the electron) · `EDGE_NOISE` 2.2 · `TONE_L` 0.97 · `TWINKLE` 0.3 · `FIELD_TINT` · `BLOB_R` 0.09 · `NECK_K` 0.6 ·
`CORE` 0.32 · `PUSH_AMT` 0.42 · `DEFLECT` 0.35 · `RING` 0.55 · `WAKE` 0.35 · `WAVE_SPEED` 0.95 · `WAVE_WIDTH` 0.03 ·
`WAVE_PUSH` 0.007 · `WAVE_DENS` 0.55 · `LINE_TONE` 0.5 · `AREA_QUIET` 0.25 · `HOT_DENS` 0.16 · `IMG_DENS` 0.9 ·
`TEXT_DENS` 0.94 · `TEXT_TONE` 0.62.
JS (top of `hero.js`): `ELECTRON_R` 22 px · `ELECTRON_SPRING` [34, 1] · `ENTER` 0.2 · `MAX_PULL` 0.42 · `REARM` 1.5 ·
`TURN_BACK` 0.14 · `BUBBLE_SPRING` [15, 0.55] · `WAVE_LIFE` 1.9 s · `HORIZONTAL_BIAS` per letter.
Ink #060606, paper #f0efea.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
