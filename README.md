# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now: the **CRDZC** wordmark, centred, as a dynamic WebGL object — flat white letters that
flip at random, lit by a dithered light that follows the pointer — inside a HUD frame, with contacts along
the bottom. No build step, no dependencies. This repo is where the full site (portfolio, case studies) will
live later.

```
index.html   the page; the wordmark is inline SVG, one <path> per letter (also the no-WebGL fallback)
style.css    ink stage, paper type, hairlines; logo size; the settle-in transitions
hero.js      boot sequence, wordmark shader, per-letter flips
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

- **The logo is the scene.** `hero.js` rasterises the SVG paths once and derives, per texel, coverage, a
  bevel height (distance to the nearest edge) and an outer glow. One fragment shader then draws the wordmark:
  letters are flat and mostly solid; a point light follows the pointer and decides how much 8×8 Bayer dither
  shows through; the dither grid gets finer around the light (a lens); slow noise makes the outlines breathe,
  more so right under the light. With no pointer, the light sweeps back and forth across the wordmark.
- **Dot field.** A sparse field of dithered dots covers the whole screen, with a slow noise in its density.
  Around the pointer (or the idle light) the dots wake up and get finer, and they burn brighter while you hover.
- **Flips.** Each letter, at random times, flips horizontally or vertically around its own centre (scale
  through zero in the shader), holds for a moment, then flips back. Moving the pointer onto a letter starts a
  flip (or puts a flipped one back); a tap does the same on touch screens. `HORIZONTAL_BIAS` in `hero.js`
  sets the odds per letter — C and D look the same flipped vertically, so they lean horizontal.
- **Boot** (~3 s, first visit per session): console lines, a counter and a progress line; just before the
  counter lands the letters rise one by one while the dither resolves from coarse to fine. Then the frame
  hairlines settle and the labels fade in.
- **Size.** The wordmark is 52 vw wide (80 vw under 700 px), vertically centred; the dither cell scales with
  it so the letters always read. Change `.logo { width }` in `style.css`.
- **Degrades**: no JS → static page with the SVG wordmark. No WebGL → same, with the letters rising in.
  `prefers-reduced-motion` → no boot, no flips, no animation, one still frame.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
