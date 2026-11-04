# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now: the **CRDZC** wordmark, centred, as a WebGL object whose letters flip when you touch
them, sitting in a field of fine dithered pixels that is continuous grain around it and thins into a
sparse dot grid toward the edges. A bordered container holds the links. No build step, no dependencies.
This repo is where the full site (portfolio, case studies) will live later.

```
index.html   the page; the wordmark is inline SVG, one <path> per letter (also the no-WebGL fallback)
style.css    ink stage, paper type, hairlines; logo size; the link container
hero.js      boot sequence, blue-noise map, wordmark + pixel-field shader, light spring, per-letter flips
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

- **Grain.** The canvas runs at one texel per dither cell and is upscaled by an integer factor
  (`image-rendering: pixelated`), so every cell is a crisp square. A cell is ~1/80 of the wordmark's height,
  clamped to 1–1.5 CSS px and never under 2 device px (1.5 px on a 2× laptop, 1 px on phones). Fine cells
  are dithered against a 64×64 **blue-noise** threshold map generated at load (void-and-cluster), so there is
  no Bayer lattice and no moiré.
- **Density, not cell size, carries the gradient.** The screen is a quadtree of 8 / 4 / 1-cell blocks; a block
  subdivides only where the local density (a noise-warped ellipse fitted to the screen, plus the light) beats a
  jittered threshold. Every dot is the same size: at the edges one dot per 8 or 4 cells (a quiet grid, dim and
  slowly twinkling), around the wordmark continuous grain. The transition is stochastic, so there are no rings.
  The wordmark and an oval around it always get full resolution. Tunables: thresholds `0.2` / `0.44` and
  jitter in `main()`, falloff in `fieldAt()`.
- **No glow, no outline.** The cloud's grain is even across the screen (organic noise patches, no pool behind
  the wordmark); only its *structure* changes from grid to fine grain, and only the pointer brightens it.
  Letters have no moat or halo ring: a signed distance to the edge (texture G inside, B outside) makes each
  letter's edge a ~2-cell dithered transition, so the field runs straight up to it.
- **Rounded, matte letters.** The rasterised mask gets its corners rounded before any distance field is
  computed: an opening by a 17-texel disc (≈ 4.9% of the letter height) rounds the outer corners, a closing by
  9 texels (≈ 2.6%) the inner ones, using an exact Euclidean distance transform so the arcs are circles.
  Texture A holds a soft inflated height (quarter-circle profile, blurred 3 × 9 texels); it only gives a
  gentle, low-contrast tonal roll-off (tone ~0.6–0.72 of paper). No specular, no glints, no rim, no
  highlight sweep. `INFLATE` and `ROUND_OPEN` / `ROUND_CLOSE` are the knobs. The no-WebGL SVG keeps the
  original sharp-cornered paths. Tones: ink #060606, paper #f0efea, far dots ~0.25, cloud ~0.31.
- **Float.** Each letter bobs, sways and tilts on its own slow, desynchronised sines (`updateFloats`), and
  lifts and leans away a little when the pointer comes near.
- **Light.** An exponential (long, soft) falloff whose edge is bent by slow noise, breathing slightly, and
  stretched into a short tail behind its motion. It hangs on a spring (lags, swings a little past, settles).
  It shades the letters softly; it brightens and sharpens the field only while someone is pointing. With no pointer for 3 s it wanders slowly over the wordmark on two incommensurate sines.
- **Flips.** Every letter starts in a **random orientation** on each load (flipped horizontally, vertically,
  both, or not at all). After that a letter only changes **on hover**: moving the pointer onto it (or tapping
  it on touch screens) turns it over around its own centre, horizontally or vertically at random, like a
  balloon: 760–980 ms, quart in-out with a small overshoot and settle, a slight lift, dimming and softening
  its edge while edge-on. `HORIZONTAL_BIAS` in `hero.js` sets the odds
  per letter — C and D look the same flipped vertically, so they lean horizontal.
- **Links.** One bordered container, hairline-separated cells, wrapping 3×2 on phones. Hover inverts a cell.
- **Boot** (~3.5 s, first visit per session): console lines, a counter and a progress line; as the counter
  nears 100 the field fills in from nothing and the letters dissolve in through the dither one by one,
  drifting up slightly. Returning visitors get only the 1.6 s entrance.
- **Size.** The wordmark is 52 vw wide (80 vw under 700 px), vertically centred. Change `.logo { width }`.
- **Degrades**: no JS → static page with the SVG wordmark. No WebGL → same SVG, with the same random
  orientations and hover flips. `prefers-reduced-motion` → no boot, no flips, no float, one still frame with the light parked above
  the wordmark's upper left.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
