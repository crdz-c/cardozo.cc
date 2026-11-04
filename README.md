# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now: the **CRDZC** wordmark, centred, as a flat WebGL object whose letters flip when you
touch them, sitting in a cloud of dithered pixels that is fine and dense around it and coarser and sparser
toward the edges. A bordered container holds the links. No build step, no dependencies. This repo is where
the full site (portfolio, case studies) will live later.

```
index.html   the page; the wordmark is inline SVG, one <path> per letter (also the no-WebGL fallback)
style.css    ink stage, paper type, hairlines; logo size; the link container
hero.js      boot sequence, wordmark + pixel-cloud shader, per-letter flips
fonts/       Big Shoulders Display (boot counter) + Geist Mono (labels), self-hosted, OFL
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.

## How the hero works

- **The logo is the scene.** `hero.js` rasterises the SVG paths once and derives, per texel, coverage, a bevel
  height (distance to the nearest edge) and an outer glow. One fragment shader draws the wordmark: letters
  are flat and nearly solid; a point light follows the pointer and decides how much 8×8 Bayer dither shows
  through; slow noise makes the outlines breathe, more so right under the light. With no pointer, the light
  sweeps back and forth across the wordmark by itself.
- **Flips.** Every letter starts in a **random orientation** on each load (flipped horizontally, vertically,
  both, or not at all). After that a letter only changes **on hover**: moving the pointer onto it (or tapping
  it on touch screens) flips it around its own centre, horizontally or vertically at random (scale through
  zero in the shader). `HORIZONTAL_BIAS` in `hero.js` sets the odds per letter — C and D look the same flipped
  vertically, so they lean horizontal.
- **Pixel cloud.** Around the wordmark, pixels are **fine and dense at the centre and grow coarser and sparser
  toward the edges** — both the cell size and the density follow one gradient, measured relative to the screen
  so it is an ellipse inscribed in any shape (wide desktop, tall phone) and warped by slow noise so it reads
  like a cloud. A thin clean moat keeps the letters crisp. The base cell scales with the wordmark.
- **Hover sharpens.** Hovering makes the whole field a little finer and a lot finer around the pointer, in a
  lens with a noise-wobbled edge, and the dots there burn brighter.
- **Links.** One bordered container, hairline-separated cells, wrapping 3×2 on phones. Hover inverts a cell.
- **Boot** (~3 s, first visit per session): console lines, a counter and a progress line; just before the
  counter lands the letters rise one by one while the pixels resolve from coarse to fine.
- **Size.** The wordmark is 52 vw wide (80 vw under 700 px), vertically centred. Change `.logo { width }`.
- **Degrades**: no JS → static page with the SVG wordmark. No WebGL → same SVG, with the same random
  orientations and hover flips. `prefers-reduced-motion` → no boot, no flips, no animation, one still frame.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
