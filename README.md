# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen for now: the **CRDZC** wordmark as the main element, a dithered WebGL orb behind it, a HUD
frame, a one-line intro and contacts. No build step, no dependencies. This repo is where the full site
(portfolio, case studies) will live later.

```
index.html   the page; the wordmark is inline SVG, one <path> per letter
style.css    ink stage, paper type, hairlines; all the settle-in transitions
hero.js      boot sequence, orb shader, pointer-driven wordmark
fonts/       Big Shoulders Display (display) + Geist Mono (labels), self-hosted, OFL
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it.

## How the hero works

- **Boot** (~2.4 s, first visit per session): console lines, a counter and a progress line while the orb
  grows from a seed and its dither cells resolve from coarse to fine. Then the frame hairlines draw in,
  headline lines slide up out of masks, and the wordmark letters rise one by one.
- **Orb**: a single fragment shader. A sphere with a noise-wobbled silhouette and noise-perturbed normals,
  lit from the pointer, then pushed through an 8×8 Bayer ordered dither into two flat colours. The dither
  grid is finer around the pointer (a lens). With no pointer the orb slowly looks around by itself.
  Its position and size come from the measured page layout, so it never sits under the headline.
- **Wordmark**: `mix-blend-mode: difference`, so letters invert where they cross the lit orb. Letters lift
  softly toward the pointer and breathe slightly when idle.
- **Degrades**: no JS → static page with the wordmark and type. No WebGL → same, without the orb.
  `prefers-reduced-motion` → no boot, no animation, one still frame of the orb.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
