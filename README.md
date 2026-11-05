# cardozo.cc

Source of [cardozo.cc](https://cardozo.cc) — Lucas Cardozo, product designer.

One screen: the **CRDZC** wordmark, centred, drawn as dots in a single dithered dot field. **Each letter is a link**,
and under each letter lies the mark of its link (envelope, LinkedIn, Dribbble, Medium, GitHub). The pointer opens the
wordmark like a curtain and reveals the marks beneath it; left alone, the letters turn into their marks on their own
and every 9 seconds everything converges back into CRDZC. A letter's own change melts one shape into the other;
under the pointer the dots part like oil on water. The pointer is drawn as a ring of dots round a black hole, inside a soft
gradient (the system cursor is hidden). A click on the background sends two pulses of one long wave across the screen:
as they pass they cancel the dots' energy for a moment and show what lies behind the wordmark, then everything comes
back. There is a light theme (true black on true white), switched from a small icon at the top right. Everything that
appears, appears the way the loading does, only faster. No build step, no dependencies (native ES modules).

```
index.html   the page: the wordmark as inline SVG, each letter an <a> (the real links, focus, screen readers)
style.css    layout; under .gl the SVG stays in place but transparent (the shader draws it)
hero.js      letter/mark textures, the dot-field shader, morphs, curtain, 9 s cycle, pointer, waves, sea, loading
brands.js    the five brand marks as SVG path data
raster.js    exact distance transform, corner rounding, blue-noise threshold map
favicon.ico  the tab icon (16, 32, 48): the wordmark's C dissolving into pixels; favicon.png (64) and apple-touch-icon.png (180) too
tools/       make-favicon.py draws those three from the C's outline and the site's blue-noise map (needs Pillow and node)
CNAME        custom domain for GitHub Pages
```

## Develop

Serve the folder (ES modules need http, not `file://`):

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. The boot sequence plays once per browser session; add `?boot` to replay it, and
`?theme=light` or `?theme=dark` to force a theme (not saved).
`?debug` exposes `window.__hero`: live `state`, `letters` (each letter's morph state), `cycle()` (ms into the 9 s
cycle or `null` while paused, the pulse, each letter's amount), `crop(x, y, w, h, zoom)` (the field as rendered, one
pixel per cell), `tick()` (advance everything to now in 16 ms steps, for scripted checks in previews that throttle
animation frames), `buildProgress(s)` (the loading curve) and `finish()` (skip the build); also `setTheme("light" | "dark")`,
`theme`, `touchState()` (the touch gesture state), `adapt(ms)` (feed a frame time to the adaptive quality) and `quality()`.
`?debug&dpr=3` renders as if the screen were 3× (to check a phone's resolution in a desktop browser).
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
focus (Tab, Enter) and screen readers keep working. A mouse click on a letter always opens its link, letter or mark; so does Enter. On touch a first tap shows the marks and a
tap on a revealed mark opens it (see *Touch*).
Keyboard focus shows that letter's mark and a dotted underline under it until focus leaves.

## Letters, marks and the morph

- Each letter has two shapes sharing one texture layout: the letter (the wordmark's own paths, corners rounded) and
  its mark beneath (every mark the same height, `BRAND_H` 9.5 of the wordmark's 15.75 units (11.2 when the wordmark is under 60 CSS px tall, a
  phone's, which has fewer dots to draw it with), centred on the letter,
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
  stretch. A change takes `MORPH_MS` 900–1300 ms (cubic ease-out), shorter when it starts part-way, and can be
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
from halfway through the loading build (`CURTAIN_FROM` 0.5); on touch see *Touch* below.

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

- **Two passes.** *Field* runs at one fragment per dither cell (≈ 1/80 of the wordmark's height, up to 1.5 CSS px, never
  under 2 device px) into a texture; *compose* upscales it, each cell an exact square. The cell used to be at least 1 CSS
  px, which on a 3× phone threw its density away: the wordmark (225 CSS px wide) had 225 × 40 cells, against ~560 × 98 on a
  1440 desktop. With the 2 device px floor a 3× phone gets 338 × 60 (0.67 CSS px cells, as sharp as a retina desktop's);
  a 2× phone is unchanged (2 device px is already 1 CSS px). Everything defined in cells follows the wordmark's resolution:
  the letter edge's softness and roughness (`EDGE_SOFT`, `EDGE_NOISE`) are tuned for a wordmark `EDGE_REF` 90 cells tall and
  scale down in proportion below that (to `EDGE_MIN` 0.45), so a small wordmark's edges are not blurrier than a big
  one's (they were 9 % of the letter's height on a phone, against ~4 %).
- **One material.** Dots are thresholded by one 64×64 blue-noise map; letters and marks sit on a checkerboard
  lattice (dense dots never fuse), the field is free blue noise (no grid, no repeating cluster). A letter or mark is
  only where those dots gather and burn paper-white; field dots are dimmer and cooler. A dot's intensity rises
  smoothly past its threshold (`DOT_FADE` 0.12, relative to the density) and is cut to zero below `DOT_FLOOR` 0.3.
- **True black (dark theme).** The ground is `#000000` everywhere (shader, CSS `--bg`, `theme-color`). Measured on a
  full-screen frame read back from the field: 649 324 of 677 740 cells exactly 0, the dimmest lit dot 16/255, nothing
  between. (Measured before the flicker below; dots now also vary in brightness, but a dot is still either lit or fully
  off.) In the light theme the ground is `#ffffff` and dots go toward `#000000`.
- **Every dot flickers.** On top of the slow per-dot breathing, each dot wanders between random brightnesses at its own
  pace (0.5–2.2 changes a second, smoothly): `FLICK_C` 0.8 deep in the field, `FLICK_L` 0.4 in the letters. Measured on
  the field: about 39 % of dots change brightness by more than a quarter within half a second.
- **Calm sea and afterglow.** A slow swell displaces the field (0.9 cells) with ~14-cell ripples, per-dot twinkle and
  a slow brightness wave. Pointer motion and waves stir up an energy (0..1) that enlarges the swell where it happened
  and decays over `AFTERGLOW` 2.8 s.
- **The pointer.** On fine pointers (`(hover: hover) and (pointer: fine)`) the system cursor is hidden while the live
  field runs (`cursor: none` on the page and the letter links; never in the no-WebGL or reduced-motion versions, never
  on touch). The pointer is a ring of dots round a black hole inside a gradient: a precise nucleus (`NUCLEUS_R` 5 CSS px, its hole `HOLE` 0.5 of that, so the hotspot reads as a black point in a ring) drawn exactly on the
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
- **Frame pacing.** Every display frame (60/90/120/144 Hz; all motion is time-based), touch included (it used to be
  capped at ~30 fps there). **Adaptive quality:** the frame time is averaged over a few seconds; if it stays above
  `ADAPT_MS` 26 (under ~38 fps) the dots get one device px coarser (`quality`, twice at most, `ADAPT_MAX`), the
  wordmark keeping its shape with fewer, bigger dots; it never goes back up. A rAF throttled to 30 Hz (iOS Low Power
  Mode) reads as slow too. Nothing is allocated per frame.
- **Waves.** A click on the background, or a tap (a click on a letter opens its link instead; on touch, see *Touch*) sends **two pulses**
  (`WAVE_PULSES` 2, `WAVE_PULSE_GAP` 0.2 s apart, the second `WAVE_PULSE_DECAY` 0.15 weaker), each one long ring
  through everything: speed 1.05 screen heights/s, life 3.2 s with a linear decay and a 0.2 s fade-in, half-width 0.1
  screen heights, push 0.008 screen heights (`WAVE_PUSH`), density and brightness swell 0.4 (`WAVE_DENS`). Up to 8
  rings overlap (four clicks); none under reduced motion. **The pulses also cancel the dots' energy and reveal what
  lies behind the wordmark.** Measured behind each front (in screen heights): a band at `WNULL_AT` 0.07 (`WNULL_W`
  0.05) where the dots' energy is cut by `WNULL` 0.9, then the reveal rises over `WREV_LEAD` 0.1, holds until
  `WREV_HOLD` 0.36 and comes back over `WREV_TAIL` 0.5, with the field thinned by `WREV_THIN` 0.65 meanwhile. The
  reveal is the curtain's: just another source for the curtain's openness, so each site switches letter → mark at its
  own moment on the way in and on the way out (the same blue-noise-rank switching, `MORPH_*`). The second pulse runs
  its energy-cancelling band through the marks the first one revealed, and holds them a little longer: a click 400
  px away shows the marks about half a second after it arrives, for roughly 0.6 s, and the letters re-form behind.
- **Size.** The wordmark is 39 vw wide, fixed in the exact centre. Under 700 px: held upright (portrait) it spans the page
  minus its own padding (`100vw − 2 × --pad`: a 343 px wordmark with 16 px margins on a 375 px phone), held sideways
  (landscape) 60 vw.

## Touch

A finger has no hover, so on touch the gestures differ; the layout does not. (`pointerType === "touch"`, WebGL and
motion on; with reduced motion or no WebGL a tap simply opens the link. Mouse, pen and keyboard keep what they had.)

| gesture | what happens |
|---|---|
| **tap the wordmark** | every letter melts into its mark and **stays** (the 9 s cycle waits); the click is swallowed, so a link is never opened before its mark was seen |
| **tap a revealed mark** | opens that letter's link |
| **tap anywhere else** | hides the marks if they are shown; if they are hidden, sends the two-pulse wave (which reveals them for a moment and takes them back) |
| **press and hold** (> `HOLD_MS` 250), **or drag** (> `TOUCH_SLOP` 10 px) | the curtain comes to the finger and follows it; letting go closes it. A hold or a drag never opens a link |

Details. The curtain is `TOUCH_CURTAIN` 1.9× the mouse's radius and sits `TOUCH_LIFT` 24 CSS px above the finger
(eased in with `state.cur.tk`, 0 mouse … 1 touch), because a fingertip covers a mouse-sized disc; the mouse's ring and
gradient are not drawn under a finger. The revealed marks hide by themselves after `REVEAL_HIDE_MS` 8 s untouched (any
touch restarts it), and when the page is left (`visibilitychange`, e.g. after opening a link in a new tab). The marks are
pinned the same way keyboard focus pins one (`pinned()`).

**Nothing may take the finger.** `html` is `overflow: hidden` with `overscroll-behavior: none`, and `html`, `body` and `.hero`
are `touch-action: pinch-zoom` (no single-finger pan, no double-tap zoom; the hero no longer has a `min-height`, which used
to make a landscape phone scroll). Without that a vertical drag was taken for a scroll or a rubber-band and the browser
cancelled the pointer, so the hold never worked upright. The page has no text to select (`user-select: none`,
`-webkit-touch-callout: none`, and a `contextmenu` guard on touch): otherwise a held finger on a phone is taken for text
and iOS opens "Look Up" (Android shows selection handles), and `::selection`, painted in the text colour, left a white
edge on the dark theme.

## How things appear

Everything that comes into the interface does so the way the loading does, only faster: one number runs 0 → 1 with an
ease-out (quick first, a soft landing), and in the shader every dot has its own moment (its blue-noise rank) at which
that number reaches it, so most dots light almost at once and a few come late, each flashing as it lands. Used by the
theme switch's icon (`ICON_IN_MS` 700), the pointer's gradient and ring when the pointer appears, the keyboard-focus
underline, the curtain and the waves' reveal. A letter ⇄ mark change is eased out too (`MORPH_MS` 900–1300; it used to
be in-out). The theme change is the loading's fill again, only faster (see below).

## Theme

Dark (true black ground, paper dots `#f0efea`) and light (true white `#fff` ground, true black `#000`). The first
paint already has the right one: an inline script in `index.html` sets `<html data-theme>` from `?theme=`, else the
saved choice (`localStorage` `cc-theme`), else the system's `prefers-color-scheme` (which it keeps following until the
visitor chooses). A switch at the top right (a 44 px `<button>`, `aria-label` "Switch to light mode" / "Switch to dark
mode"; the shader draws it in solid pixels, **a moon in the dark theme and a sun in the light one** (a crescent; a disc
with eight rays), each cell drawing the shape of the theme it is in, so the icon turns moon ⇄ sun pixel by pixel with
the rest of the screen; the SVG fallback does the same with CSS; hover or focus lights it) toggles it. Both palettes
live in the shader.

**Light is not just the dark one inverted.** Black dots on white at the dark theme's density read as grey, so in light
the letters and marks are *ink*: no checkerboard lattice and extra density (`LIGHT_INK` 0.7), so every cell inside them
is lit, and they flicker less (`FLICK_L_INK` 0.22), which reads as solid black with a slight grain. The field is where
the greys live: its dots are darker (`LIGHT_FIELD` 1.7×) and a bit denser (`LIGHT_FIELD_DENS` 1.35×), so ambient dots
span many tones of grey against the black, and the marks keep their own tones (the envelope's flap, its sides).

**The change is the loading's fill, only faster, in the very pixels the dots are made of, spreading out from the switch.**
There is no gradient and no blocks: the progress eases out over `THEME_MS` 1500 (`1 − (1 − t)^2.4`: quick at first, a
long soft landing, monotone). It does not reuse the build's own rate curve: that one has abrupt bursts which, squeezed
into a second and a half, read as stop-and-go (measured: the progress step per frame varied 16× within the run; now the
change per frame is a smooth bell, rising, peaking mid-way and fading to zero, with the page at ~120 frames a second
and no frame over 25 ms). Every cell of the field, the background included (one cell = one dot, 1–1.5 CSS px), flips palette when that progress passes its own rank. The rank is mostly
the cell's distance from the switch (`THEME_SPATIAL` 0.78, normalised to the farthest corner), so the change **spreads
outward from the button**, plus white noise per cell (`hash12` in the shader: a hash, no tile, no repeat), so the front
is a random dissolve of pixels, not a line. (The noise first came from the 64×64 blue-noise map, which repeats every
64 cells and whose neighbours are anti-correlated: half-way through, cells 64 apart matched 99 % of the time and read as
a pattern. With the hash, neighbours and cells 64 apart match 50 %, as random does.) Each cell fades over a
window of several frames (`THEME_SOFT` 0.14 of the progress: about 100 ms at the start, longer later), never a pop. The density and tone rules above follow each cell, so
letters turn from dots to ink (or back) pixel by pixel as the front reaches them. Asked again mid-change, the running
one lands at once and the new one starts from the button. CSS vars `--bg` / `--fg`, `theme-color` and `color-scheme`
follow when it ends. Under reduced motion it switches at once.

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
- **No WebGL:** the same SVG links, system cursor kept, the theme switch as a plain SVG icon. Letters keep their random orientation and run the same 9 s
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
`BREATHE` 0.03 · `WAVE_SPEED` 1.05 · `WAVE_WIDTH` 0.1 · `WAVE_PUSH` 0.008 · `WAVE_DENS` 0.4 · `HOLE` 0.5 · `FLICK_C` 0.8 · `FLICK_L` 0.4 ·
`WREV_LEAD` 0.1 · `WREV_HOLD` 0.36 · `WREV_TAIL` 0.5 · `WREV_THIN` 0.65 · `WNULL_AT` 0.07 · `WNULL_W` 0.05 · `WNULL` 0.9 · `THEME_SOFT` 0.14 · `THEME_SPATIAL` 0.78 ·
`LIGHT_INK` 0.7 · `LIGHT_FIELD` 1.7 · `LIGHT_FIELD_DENS` 1.35 · `FLICK_L_INK` 0.22 · `LIGHT_SOFT` 0.08 · `LIGHT_OVER` 1.25 · `LIGHT_FLASH` 0.3 · `BG_D` / `FG_D` / `BG_L` / `FG_L` (the two palettes).
JS (top of `hero.js`): `POINTER_R` 32 px · `NUCLEUS_R` 5 px · `POINTER_SPRING` [30, 1] · `POINTER_LAG` 0.3 ·
`AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s · `CURTAIN_R` 0.85 · `CURTAIN_SPRING` [16, 1] · `REPEL_OPEN` [7, 0.8] · `REPEL_CLOSE` [3.2, 1] · `CURTAIN_OPEN` 10/s ·
`CURTAIN_CLOSE` 3/s · `IDLE_MS` 3000 · `MORPH_MS` 900–1300 · `CYCLE_MS` 9000 · `SOLO_AT` 700–3600 · `SOLO_BACK` 0.5 ·
`SOLO_BACK_AFTER` 1700–2600 · `CONVERGE_AT` 6200 · `CONVERGE_STAGGER` 500 · `PULSE_AT` 6000 · `PULSE_MS` 3600 ·
`WAVE_LIFE` 3.2 s · `WAVE_PULSES` 2 · `WAVE_PULSE_GAP` 0.2 s · `WAVE_PULSE_DECAY` 0.15 · `MAX_WAVES` 8 · `ICON_R` 11 px · `ICON_IN_MS` 700 ·
`THEME_MS` 1500 · `BUILD_RATE` (above) · `BUILD_S` 8 s · `BUILD_QUICK` 2.8 s · `CURTAIN_FROM` 0.5 · `BRAND_H` 9.5
units (11.2 on small wordmarks) · `EDGE_REF` 90 · `EDGE_MIN` 0.45 · `HOLD_MS` 250 · `TOUCH_SLOP` 10 px · `REVEAL_HIDE_MS` 8 s ·
`TOUCH_CURTAIN` 1.9 · `TOUCH_LIFT` 24 px · `ADAPT_MS` 26 · `ADAPT_MAX` 2 · `BRAND_ROUND` [4, 3] texels · `ROUND_OPEN` / `ROUND_CLOSE` 17 / 9 texels. Dark: ground `#000000`, dots `#f0efea`; light: ground `#ffffff`, dots `#000000`.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
