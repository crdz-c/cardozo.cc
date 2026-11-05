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
lab/         the hero's dot material on its own, on 3D models you can turn: the CD, pixel text in Jersey 25, any picture or loop (see Lab, and lab/LEARNINGS.md)
tools/       make-favicon.py draws those three from the C's outline and the site's blue-noise map (needs Pillow and node);
             make-cd.py cleans the lab's CD (takes the hand out of a photo of it; needs OpenCV and numpy);
             test.sh runs the lab's tests
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
`theme`, `touchState()` (the touch gesture state), `adapt(ms)` (feed a frame time to the adaptive quality) and `quality()`;
for the zoom: `view`, `zoomBy(dlog, x, y)`, `resetZoom()`, `stepView(now, dt)` (run the view on a clock of your own: a preview that
throttles frames can still be measured), `toScene(x, y)`, `shot()` (the composed screen as a PNG data URL), `cell()`, `dpr()`.
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

The links live in `index.html`: each letter's `<g class="lt">` sits inside an SVG `<a>`. **A link answers to the letter or
the icon itself, and nothing round them** (the whole column, with its empty corners, used to be the target, and a tap near
one opened it by accident): the `<rect class="hit">` boxes are not hit-testable (they only give keyboard focus its rect), the
letter's own shape is while the link shows its letter, and the mark's own box (`.mk-hit`, added by `makeBrandGroups()` from
the mark's measured size) is while it shows its mark; both are while the curtain has revealed the mark round the pointer.
`updateLetters()` toggles `.hit-lt` / `.hit-mk` on each link as its face changes; the SVG letters are mirrored exactly as
the drawn ones are (a random identity per visit), or a tap would land on the unmirrored shape. Measured over 3 500 random
points on the wordmark: 1 707 of the 1 719 points that hit a link were on drawn ink (the other 12 are edge pixels), and the
column's corners, the hollow of a "C", and the space above and below answer nothing; with the marks showing, the icon's
box answers and 4 px outside it nothing does. Web links open in a new tab
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
  over bright letters and marks; around it a soft, faint haze of the same dots, thinning outward (`GRAD_R` 0.7 ×
  `POINTER_R` 32 px, `GRAD_D` 0.5, brightness `GRAD_TONE0` 0.12 at its edge to `GRAD_TONE1` 0.42 at its centre, in the field's
  own cool tint, never white: only the ring is bright; it used to be 0.95 and full white, which read as a loud orbit round
  the ring and was cut by 61 % in mean level, from 110/255 to 24/255 just outside the ring), breathing slowly (`BREATHE` 3 %). The gradient's
  centre follows on a spring (`POINTER_SPRING` ω 30, critically damped) but never trails by more than `POINTER_LAG`
  0.3 × 32 px. Over a letter-link the nucleus grows 25 % and the gradient tightens 15 % and brightens 30 %. The dot
  pushes the field out radially (`PUSH_AMT` 0.6, thinner inside `THIN` 0.6, compressed just outside `RING` 0.35),
  bends it sideways with speed (`DEFLECT` 0.35) and leaves a short wake (`WAKE` 0.3); stretch along motion is subtle
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
| **two fingers** | pinch: zoom the view into the pixels (see *Zoom*), anchored between the fingers, which also pan it |
| **drag, zoomed in** | pans the view (one finger); a still press still brings the curtain |

Details. The curtain is `TOUCH_CURTAIN` 1.9× the mouse's radius and sits `TOUCH_LIFT` 24 CSS px above the finger
(eased in with `state.cur.tk`, 0 mouse … 1 touch), because a fingertip covers a mouse-sized disc; the mouse's ring and
gradient are not drawn under a finger. The revealed marks hide by themselves after `REVEAL_HIDE_MS` 8 s untouched (any
touch restarts it), and when the page is left (`visibilitychange`, e.g. after opening a link in a new tab). The marks are
pinned the same way keyboard focus pins one (`pinned()`).

**Nothing may take the finger.** `html` is `overflow: hidden` with `overscroll-behavior: none`, and `html`, `body` and `.hero`
are `touch-action: none` (the browser pans and zooms nothing: the view does, see *Zoom*; the hero no longer has a
`min-height`, which used to make a landscape phone scroll). Without that a vertical drag was taken for a scroll or a rubber-band and the browser
cancelled the pointer, so the hold never worked upright. The page has no text to select (`user-select: none`,
`-webkit-touch-callout: none`, and a `contextmenu` guard on touch): otherwise a held finger on a phone is taken for text
and iOS opens "Look Up" (Android shows selection handles), and `::selection`, painted in the text colour, left a white
edge on the dark theme.

## Zoom

The wheel, a trackpad's pinch (which a browser reports as ctrl+wheel), two fingers, or the `+` / `−` keys zoom the view
(plain scrolling follows the natural direction: scrolling "down", which on a Mac with natural scrolling is a swipe up, zooms
in, whatever the system's setting makes of the gesture; a pinch zooms in as the fingers spread; `ZOOM_WHEEL` is signed, make
it negative to flip scrolling)
into the pixels, as if the page were a canvas: **what is magnified is the field's own cells**, so at the limit every dot is a
plain square (`ZOOM_CELL_PX` 28 CSS px wide: 28× where a cell is 1 CSS px, up to 42× on a 3× phone) and what each one does
(twinkle, flicker, a morph, a wave, the theme change) can be watched. `0` resets. Dragging pans a zoomed view (mouse; one
finger); a click on the background still sends the wave (on the release, so a drag does not), a press still brings the curtain.

- **How it renders.** The scene is drawn exactly as before, at the unzoomed layout; the compose pass magnifies it
  (`uZoom`, `uPan`: nearest, so each cell is a square of its own colour). The pointer, the curtain, the waves and the
  focus underline live in scene coordinates (`toScene()`), so they scale with the scene. The mouse's ring and gradient
  fade out as it zooms (the system cursor returns: a grab hand, closed while it drags); a finger's lifted curtain is a
  screen distance, so it is divided by the zoom.
- **The links stay put.** The `.logo` SVG, whose `<a>` elements are the real links, gets the same transform in CSS (about its own
  corner, `applyView()`), so a click, hover or keyboard focus lands on what is drawn. The wordmark's own place for the shader
  (`measureLogo()`) divides that zoom out.
- **The buttons stay on the screen.** The theme switch and the zoom reset are not part of the scene: the compose pass draws their
  icons (moon / sun; four corner brackets round a pixel, "fit") in screen cells, with a one-cell ground-coloured outline
  once zoomed, and the focus underline, with the same per-cell theme change as the scene. The reset button (right, bottom,
  sticky) lights in once the zoom passes `ZOOM_SHOW` 1.04 and goes out at 100 %.
- **Fluid while moving, never half a pixel at rest.** The shown zoom (in log space) follows its target on a critically damped
  spring (`ZOOM_OMEGA` 15, `ZOOM_OMEGA_DIRECT` 48 while fingers hold it): no jerk at the start of a gesture, the same at 30, 60
  and 120 Hz. Past the limit it stretches on a rubber band (`ZOOM_SOFT` 0.12 in log units) and settles back. After
  `ZOOM_IDLE_MS` 170 without input it **settles onto a zoom where every cell is a whole number of device px** (steps of
  1/cell: 1×, 1.5×, 2×… with 2 px cells), **going the way the gesture was going** (in when zooming in, out when zooming out, so even a
  small gesture lands on the next step instead of snapping back), as a glide on that same spring, not a jump; and the pan lands
  on whole device px. Measured on the composed screen at 1.5×, 2×, 11× and the 28× limit: every run of one colour along
  the sampled rows is a multiple of the cell's size in device px (0 of 540, 466, 265 and 107 were not).
  A released drag glides on (`PAN_FRICTION` 4.5/s, when faster than `PAN_GLIDE_MIN` 70 px/s) and stops at the scene's edge, which
  the view never shows past.
- **The way back to 100 %** (the button, or `0`) is one glide, not a spring on the zoom alone (which, when the scene's edge caught
  the view on the way out, drifted it sideways): the log-zoom runs out on a smootherstep (no jerk at either end) while the scene
  point at the middle of the screen flies to the scene's own centre, so it lands on exactly 100 % with nothing left to correct.
  It lasts `RESET_BASE` 0.6 s plus `RESET_PER_LOG` 0.2 s per unit of log-zoom (0.8 s from 3×, 1.3 s from the 28× limit);
  measured on a virtual clock the zoom only ever decreases, its speed at the first and last frame is 0.6 % and 0.1 % of the
  peak, and it ends at z = 1, t = 0 with the CSS transform cleared. Any wheel, key, drag or pinch during it takes over from where
  it is (no jump).
- **Holding a point.** Wheel or pinch zooms about the cursor or the midpoint of the fingers (the scene point under it stays under it);
  two fingers also pan. Zoom needs WebGL and motion: with reduced motion or no WebGL the page does not zoom.

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
mode"; the shader draws it **in the letters' own material**, **a moon in the dark theme and a sun in the light one** (a
crescent; a disc with eight rays): dots on the checkerboard lattice in the dark theme, solid ink in the light one, the edge
a ramp of density the dots dither across (`ICON_EDGE`), each dot twinkling and flickering like theirs (it was solid pixels, which
read as too filled), each cell drawing the shape of the theme it is in, so the icon turns moon ⇄ sun pixel by pixel with the
rest of the screen; the SVG fallback does the same with CSS; hover or focus lights it) toggles it. Both palettes
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
`SEA_STIR` 4.0 · `SEA_GLOBAL` 1.2 · `SEA_SCALE` 0.3 · `SEA_SPEED` 0.05 · `SEA_RIPPLE` 0.07 · `GRAD_R` 0.7 · `GRAD_D`
0.5 · `GRAD_TONE0` 0.12 · `GRAD_TONE1` 0.42 · `MOAT` 1.5 · `PUSH_AMT` 0.6 · `DEFLECT` 0.35 · `RING` 0.35 · `THIN` 0.6 · `WAKE` 0.3 · `STRETCH` 0.1 ·
`BREATHE` 0.03 · `WAVE_SPEED` 1.05 · `WAVE_WIDTH` 0.1 · `WAVE_PUSH` 0.008 · `WAVE_DENS` 0.4 · `HOLE` 0.5 · `FLICK_C` 0.8 · `FLICK_L` 0.4 ·
`WREV_LEAD` 0.1 · `WREV_HOLD` 0.36 · `WREV_TAIL` 0.5 · `WREV_THIN` 0.65 · `WNULL_AT` 0.07 · `WNULL_W` 0.05 · `WNULL` 0.9 · `THEME_SOFT` 0.14 · `THEME_SPATIAL` 0.78 ·
`LIGHT_INK` 0.7 · `LIGHT_FIELD` 1.7 · `LIGHT_FIELD_DENS` 1.35 · `FLICK_L_INK` 0.22 · `LIGHT_SOFT` 0.08 · `LIGHT_OVER` 1.25 · `LIGHT_FLASH` 0.3 · `BG_D` / `FG_D` / `BG_L` / `FG_L` (the two palettes).
JS (top of `hero.js`): `POINTER_R` 32 px · `NUCLEUS_R` 5 px · `POINTER_SPRING` [30, 1] · `POINTER_LAG` 0.3 ·
`AFTERGLOW` 2.8 s · `MAX_SPEED` 2400 px/s · `CURTAIN_R` 0.85 · `CURTAIN_SPRING` [16, 1] · `REPEL_OPEN` [7, 0.8] · `REPEL_CLOSE` [3.2, 1] · `CURTAIN_OPEN` 10/s ·
`CURTAIN_CLOSE` 3/s · `IDLE_MS` 3000 · `MORPH_MS` 900–1300 · `CYCLE_MS` 9000 · `SOLO_AT` 700–3600 · `SOLO_BACK` 0.5 ·
`SOLO_BACK_AFTER` 1700–2600 · `CONVERGE_AT` 6200 · `CONVERGE_STAGGER` 500 · `PULSE_AT` 6000 · `PULSE_MS` 3600 ·
`WAVE_LIFE` 3.2 s · `WAVE_PULSES` 2 · `WAVE_PULSE_GAP` 0.2 s · `WAVE_PULSE_DECAY` 0.15 · `MAX_WAVES` 8 · `ICON_R` 11 px · `ICON_IN_MS` 700 · `ZOOM_CELL_PX` 28 · `ZOOM_OMEGA` 15 · `ZOOM_OMEGA_DIRECT` 48 · `ZOOM_WHEEL` 0.0018 ·
`ZOOM_WHEEL_PINCH` 0.012 · `RESET_BASE` 0.6 · `RESET_PER_LOG` 0.2 · `ICON_DENS` 0.95 and `ICON_EDGE` 0.9 (in the compose shader) · `ZOOM_SOFT` 0.12 · `ZOOM_IDLE_MS` 170 · `ZOOM_SHOW` 1.04 · `ZOOM_KEY` 0.4 · `MOUSE_SLOP` 4 px · `PAN_FRICTION` 4.5 ·
`PAN_GLIDE_MIN` 70 ·
`THEME_MS` 1500 · `BUILD_RATE` (above) · `BUILD_S` 8 s · `BUILD_QUICK` 2.8 s · `CURTAIN_FROM` 0.5 · `BRAND_H` 9.5
units (11.2 on small wordmarks) · `EDGE_REF` 90 · `EDGE_MIN` 0.45 · `HOLD_MS` 250 · `TOUCH_SLOP` 10 px · `REVEAL_HIDE_MS` 8 s ·
`TOUCH_CURTAIN` 1.9 · `TOUCH_LIFT` 24 px · `ADAPT_MS` 26 · `ADAPT_MAX` 2 · `BRAND_ROUND` [4, 3] texels · `ROUND_OPEN` / `ROUND_CLOSE` 17 / 9 texels. Dark: ground `#000000`, dots `#f0efea`; light: ground `#ffffff`, dots `#000000`.

Visual direction is inspired by christendijoux.com; the shader, motion and code here are original.

## Lab

`lab/` is the hero's material with nothing else on screen (no wordmark, links, curtain, theme switch or zoom) on **models you can
turn**: the CD, pixel text in Jersey 25, or any picture, video loop or animation. Open <http://localhost:8000/lab/>. It shares
`raster.js` with the hero and nothing else, and it is `noindex`. (Pages serves it too, at `/lab/`.) What was learned building it,
and what was tried and dropped, is in [lab/LEARNINGS.md](lab/LEARNINGS.md).

```
lab/index.html     the page: one canvas
lab/lab.js         picks the model (?model=cd | text | picture) and runs the engine
lab/engine.js      the reusable engine: the hero's material on a 3D plate you turn; dolly, the wave, the build
lab/math.js        the engine's pure logic (build curve, quaternions, camera and pixel layout, text timing): no DOM, tested under node
lab/models/        cd.js · text.js · picture.js (index.js lists them): what goes on the plate and how it is shown
lab/media/cd.png   the CD's sprite, made by tools/make-cd.py
lab/fonts/         Jersey 25 (SIL OFL, from google/fonts) for the text model
lab/test/          the tests: *.test.mjs under node, index.html + browser.js in a browser (see Tests)
```

**Models, and using the engine elsewhere.** A model is `{ id, params, create(helpers, arg) → source }`: `params` are the knobs it
changes from the engine's defaults, `create` returns what goes on the plate (see the comment at the top of `engine.js` for the
source's shape). The CD is the reusable asset: `models/cd.js` + `media/cd.png` + `tools/make-cd.py`. To put it, or any model, in
another page (ES modules, no build):

```js
import { createEngine } from "./lab/engine.js";
import cd from "./lab/models/cd.js";
const lab = createEngine({ canvas: document.querySelector("canvas") });
await lab.useModel(cd);
lab.run();
```

**How it works.** The plate is not a mesh. For every dither cell the *field* pass casts a ray from a perspective camera and meets
the plate analytically: a **disc** (two faces, the rim, and the wall of the hole, which is 0.118 of the CD's radius) or a **card**
(a box with the picture's proportions; anything that is not the CD). The texture is read where the ray lands (1024² with mipmaps
and anisotropic filtering, so a slanted face stays clean), its luminance is the tone, and the hero's dots print it: a cell's tone
is the density of its dots; bright areas sit on the checkerboard lattice so dots never fuse, as the letters do; dim ones are free
blue noise, as the field is. A face turned away is a little darker (`shade`), its far side darker still, and a wall catches a light
from the upper left. The dither is fixed to the screen, so the model turns under it. *Compose* then blows the cells up to exact
squares. Kept from the hero, with its numbers: the blue-noise dither, `DOT_FADE`, `DOT_FLOOR`, the per-dot twinkle and flicker, the
ambient field with its calm sea (centred on the screen now), the build curve (dots land at random when a picture appears,
`?build=2.8` s) and the wave. Different from it: the shape is a tone map, not a mask, so a dim tone's dots are only a little
dimmer (`TONE_BRIGHT` 0.75, the hero's marks use 0.5) and the density carries the tone; a cell is `?cell=1.2` CSS px (what the
wordmark has on a desktop). There is only the dark theme.

**Turning it.**

| input | what |
|---|---|
| drag (mouse, one finger) | turns the model about the screen's axes, the near side following the pointer; across the screen's shorter side is 195° (`ROT_PER_SIDE` 3.4 rad). The shown pose follows the dragged one eased (`FOLLOW_DRAG` 26/s: fluid, a little behind). On release it keeps gliding at the speed of the last ~50 ms of the drag (at most `MAX_SPIN_RATE` 16 rad/s) and slows (`FRICTION` 4/s); a touch stops it; held still before letting go means no glide |
| wheel, pinch, two fingers, `+` `-` | dolly the camera in and out, eased (`ZOOM_FOLLOW` 14/s), between ×0.43 and ×2.6; scrolling down moves in, as on the hero, and so does a pinch apart |
| arrows | turn by 15° |
| `R` or `0` | back to the home pose (`rx` 26° tilt, `ry` -20°; the text model's is flat) and distance |
| click or tap | a press that does not move (under `MOUSE_SLOP` 4 px, 10 on touch) and is released within 450 ms sends the wave from there |
| `Space`, `B` | pause (spin, dots, waves and video; the model can still be turned), replay the build |

**The wave.** The hero's, with its numbers: two pulses 0.2 s apart (the second 15 % weaker), each one long ring crossing the screen
in ~3 s. The dots, the model included (it is sampled from displaced positions, so it ripples), are pushed along the ring, swell in
density, the field thins behind the front and the dots' energy is cancelled in a band just behind it (a dark ring opens and travels
across the model), and the sea is stirred (energy 0.85, settling over 2.8 s). What the hero reveals behind its wordmark has no
counterpart here.

**Pixel text** (`?model=text`). Jersey 25 set in dots, and it appears **word by word, pixel by pixel**: a word's pixels land at
random (the hero's build curve, per word: bursts and a slow tail), the next word starts a beat after, until the text is complete.
Jersey 25's grid is 41 pixels to the em, so it is rasterised 8× big at 328 px and each of its pixels read at the centre; a font pixel
becomes a *block* of a whole number of cells (the biggest that fits `size`, or `?px=`), the sheet's edge snapped to a cell boundary,
so every pixel is a square of the same cells and the dither never cuts one in two. Each pixel's own fill lets the dots inside it
land one by one and flash as they do (the engine's pixel mode: `r` ink, `g` fill, `b` flash, read with NEAREST). The text is a
flat sheet that faces you (turn it, it still works) with no thickness and no edge.

| param | default | |
|---|---|---|
| `text` | `feeling\|nostalgic?` | `\|` or a new line starts a line; words are split on spaces |
| `align` / `leading` | `center` / 1 | `left`; line spacing × 34 px |
| `word` / `gap` | 1.1 / 0.3 | seconds a word takes to land, and between words |
| `fill` / `flash` | 0.3 / 0.2 | seconds a pixel takes to fill in, and its flash lasts |
| `order` | `random` | `ltr`: a word fills left to right, with scatter |
| `loop` | 0 | seconds of rest before it all happens again (0: once) |
| `px` | auto | cells per font pixel (auto: as many as fit `size` 0.8 of the screen) |

The timing is live in `__lab.source.opts`; `__lab.text("hello|world")` sets other text; `B` replays.

**Put a picture on it** (`?src=…` or the `picture` model: anything that is not the CD becomes a card of its own proportions).

| how | what |
|---|---|
| `?src=media/clip.mp4` | a URL (same origin, or CORS-enabled): image, animated GIF, mp4/webm (muted, looped). Put files in `lab/media/` |
| drop or paste a file | the same, from disk or the clipboard; the dots build in again |
| `?src=sketch:rings`, `sketch:sweep` | built-in animations drawn in JS (white on black, on a square card) |
| `__lab.sketch((ctx, t, W, H) => …)` | your own: draw on the 1024² texture, `t` in seconds |
| `__lab.load(urlOrFileOrSketch)` | any of those from the console |
| `?shape=disc`, `?hole=0.2` | put a picture on a disc instead (it is inscribed in the disc's square), with a hole of that radius |

**Knobs.** Query parameters, also live in `__lab.P` (change one, it applies on the next frame; `cell` needs `__lab.resize()`). The
defaults are the engine's (`GENERIC_PARAMS`, tuned on the CD); a model changes some (the CD spins, the text is flat).

| param | default | |
|---|---|---|
| `spin` | 40 for the CD, 0 for the rest | deg/s about the plate's own axis, positive clockwise |
| `rx` / `ry` | 26 / -20 | the home pose: tilt back and turn sideways, degrees |
| `size` / `fit` | 0.8 / `contain` | the plate's share of the screen at home (a disc's diameter, a card's longer side); `fit=cover` makes a card fill the screen |
| `thick` / `shade` | 0.02 / 0.35 | the plate's thickness, × the disc's radius (0.02 is a real CD's: 1.2 mm on 60), and how much a slanted face darkens |
| `dens` | 1.2 | share of lattice sites lit at full tone (the hero's letters: 0.72, which the text uses); above 1 the brightest tones saturate to a solid checkerboard |
| `black` / `white` / `gamma` | 0.3 / 0.9 / 1 | levels and curve applied to the luminance. The CD's body sits between 0.5 and 0.72, so it needs the stretch; a high-contrast picture wants `black=0&white=1` |
| `lattice` | 1 | 0 prints free blue noise instead of the checkerboard (denser, more like a stipple) |
| `field` | 1 | the ambient dots round the plate, 0 … 1 |
| `color` | 0 | 0 paper-white dots (the hero); 1 each dot takes its source's hue |
| `flicker` | 1 | depth of the picture's flicker, × the hero's |
| `build` | 2.8 | seconds the dots take to land (pictures; the text has its own timing); 0 turns the build off |
| `tex` | 1024 | the texture's side (a power of two) |

`?dpr=` imitates another screen's pixel ratio. Debug: `__lab.pose(rx, ry)` sets the pose at once, `__lab.turn(dx, dy)` turns as a drag
of that many px, `__lab.wave(x, y)` sends the wave, `__lab.model(id, arg)` switches model, `__lab.step(ms)` advances the clock and
draws (use it, with `performance.now` stubbed if you drive pointer events, in a preview whose pane is hidden: the browser runs no
animation frames there), `__lab.shot()` returns the screen as a PNG data URL, `__lab.info()` the sizes, plate, layout and source,
`__lab.view` the pose, `__lab.source` the source on the plate.

**The CD.** `tools/make-cd.py` makes `media/cd.png` from a picture of a CD held in a hand (not in the repo): it finds the hand,
fits an ellipse to the rim and warps the disc to a true circle, makes the hub concentric with the rim (it sat 17 px off, which
would wobble as the disc spins) while keeping every wedge radial, mirrors the hub's good half over the thumb's, repeats another
stretch of the wedge sequence over the hand with the seam where the colours match best, and writes a 1024² sprite with the disc
at 92 %. It is a one-off tuned on one picture. A photo of a different CD needs new constants.

## Tests

The lab has tests: 28 under node and 32 in a browser. No dependencies, no build.

```bash
tools/test.sh           # node tests: lab/test/*.test.mjs, 28 of them, ~1 s
tools/test.sh --serve   # …and serves the repo on :8000 for the browser suite: open http://localhost:8000/lab/test/
```

- **`lab/test/math.test.mjs`** (node): the pure logic of `lab/math.js`. The build curve (monotone, the hero's table, its inverse),
  the rotations (which way a drag turns, rotation matrices, slerp's short way, the matrices GLSL receives), the camera (what share of
  the screen a disc or a card takes, in any window), the pixel layout (a font pixel is a whole number of cells, edges on cell
  boundaries, over 400 random screens) and the text's timing (a word is complete before the next begins).
- **`lab/test/raster.test.mjs`** (node): `raster.js`, which the hero shares: the distance transform is exactly Euclidean, corners
  round alike, the blue-noise map is uniform and measurably blue (mean nearest-neighbour distance 2.5 against white noise's 1.5).
- **`lab/test/repo.test.mjs`** (node): the assets are what they claim (the CD is a 1024² RGBA PNG; Jersey 25 is a TrueType font with
  its licence), every file the README names exists, every engine knob and its default is in the README.
- **`lab/test/index.html` + `browser.js`** (a browser): the engine for real, 32 tests on an 800 × 600 canvas at 1×. What a plate takes
  of the screen and where, foreshortening, the thickness edge-on, the hole, the lattice; the wave's two rings, where they are and that
  everything comes back; dragging (angle, direction, lag, glide, stop, no glide when held still), taps, long presses, wheel, pinch,
  keys, pause; models bringing and taking their knobs, a query parameter beating both; pictures, sketches, bad URLs, the build; and
  the pixel text: the font's grid fits, the bitmap is the text, every lit run on screen is a whole number of font pixels starting on
  the grid, words land one after another, `order=ltr`, `loop`, turned in 3D, crossed by the wave. It never waits for a frame or the
  clock (the engine is stepped, the pointer runs on a virtual `performance.now`), so it passes in a background tab or a hidden pane.
  The title says `PASS 32/32` or `FAIL`, `window.__tests` has the results, `document.body.dataset.done` flips when it ends.

Not automated yet: running the browser suite from the command line (headless Chrome would not start in the sandbox this was written
in), so it is not in any CI. The tests were checked by breaking the code on purpose (10 mutations: the leftover spin, the half-cell
shift, the wave's cancelling, the tap time, the glide's friction, the drag's direction, the thickness, the pixel grid read a pixel
off, the order of the build, the build's inverse): the suite fails every time, and names the right test.

## Deploy

GitHub Pages serves `main` from the repo root. Push to `main` and it is live.

## History

Earlier versions (the August 2025 portfolio page, the single intro page, and the Astro rebuild from the
private `cardozo-portfolio` repo) are in the git history.
