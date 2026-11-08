# Plankton

> A pixel material for interfaces. Dots in the dark that behave as if each one were alive: they land, flicker, drift, part
> when touched and settle again, every one at its own pace.

Plankton is the style of [cardozo.cc](https://cardozo.cc): the home's wordmark and [/disk](../README.md#disk) are made of it.
This file is its specification and the hand-over for whoever works on it next: what it is, the rules that make it itself, the
interface every page carries, every animation with its numbers, what exists today and what does not.

> **Where things stand (2026-11-08).** The **home is the reference** for every effect, and the home and `/disk` are the only
> pages on the style. A third page, `/tebet` (a video in 2D), was built, reviewed by Lucas, and then **removed with everything
> it had added**: the page, its clip, the 2D module under it and an unfinished port of the home's effects. At his word the video
> is also purged from the repository's history ("Tebet sai", then "apaga e mantém só o /disk", 2026-11-08). §10 is what it
> taught. Settled with Lucas: the two layers are **surface and beneath** (§3), and "no colour in the background" meant the grey
> haze round a sheet, not a dark page. Open: the name, and what the next page is (§10).
>
> **The home is now an engine (§15).** Lucas, 2026-11-08: the new pages are to be *made from the home's own code*, with all its
> effects and the links that show in the background, and a transition between them. `hero.js` now draws any **sheet** (the
> wordmark is one; a page, built from real DOM, is another) with the same shader, and the dots of the old sheet **walk** to the
> new one. The home is unchanged, pixel for pixel (a harness proves it, both themes); **no page ships yet** (a placeholder was
> built and Lucas sent it away); `?debug&demo` adds a throw-away one. The arrow that opens a page is in the HTML when a page is.
>
> **Experiment, now superseded in its look but not removed:** `/swarm` (§14): one set of dots that walks between the wordmark, a
> panel, a picture and three 3D shapes. It is where the walk was found; unlisted, not the home's interface.

- [1. The name](#1-the-name)
- [2. The laws](#2-the-laws)
- [3. Two layers](#3-two-layers)
- [4. The shell](#4-the-shell)
- [5. Interface elements and their states](#5-interface-elements-and-their-states)
- [6. The animations](#6-the-animations)
- [7. The material](#7-the-material)
- [8. What exists](#8-what-exists)
- [9. Building a page on it](#9-building-a-page-on-it)
- [10. History: the /tebet attempt](#10-history-the-tebet-attempt)
- [11. Status: what is not built](#11-status-what-is-not-built)
- [12. Next explorations](#12-next-explorations)
- [13. Checking things](#13-checking-things)
- [14. Experiment: /swarm, one set of dots](#14-experiment-swarm-one-set-of-dots)
- [15. The home as an engine: sheets, pages and the walk](#15-the-home-as-an-engine-sheets-pages-and-the-walk)

## 1. The name

**Plankton**, after the bioluminescent kind: specks in dark water that give off light when something moves through them, keep
it for a moment after it has gone, and drift on a swell nobody commands. That is the whole behaviour of the material, and the
code already speaks that language (*calm sea*, *energy*, *afterglow*, *oil on water*, *landing*). The name was proposed on
2026-11-08 and has not been confirmed by Lucas.

Called by this name: the **material** (the dots and everything they do) and the **style** when a brief says "make it
Plankton". Not called by it: any one page.

Other names were considered and are not used: *Firefly* (vaga-lume: dots that flicker in the dark; taken by too many products)
and *Murmur* (a murmuration: many parts moving as one body, each on its own account; the collective half is true, the glow is
not). If the name changes, it is one search: it appears in `docs/`, `CLAUDE.md`, the README and the docs test.

Words used below, once, so they mean one thing:

| word | meaning |
|---|---|
| **cell** | one square of the dither grid: the home's rule is a wordmark's height / 80, up to 1.5 CSS px, never under 2 device px. One cell is one dot site |
| **dot** | a cell that is lit. Every dot is a true square of cells; nothing is anti-aliased or scaled |
| **field** | the ambient dots over the whole screen, dim and cool, in free blue noise |
| **sheet** | what is printed in dots: a wordmark, a picture. It is the *content*; the field is the *air* |
| **surface / beneath** | what you see, and what lies under it, drawn in the same dots at the same place and revealed on demand (§3) |
| **lattice** | the checkerboard the sheet's mid-tones sit on, so dense dots never fuse into a blob |
| **rank** | a cell's number in the blue-noise map (0…1). It decides *when* that dot changes, so changes are random-looking and even |
| **tone** | the sheet's luminance after levels. **Tone is density**: it sets how many dots are lit, not how bright they are |
| **curtain** | the disc the pointer opens in the surface, showing the beneath |
| **melt** | one shape (or frame) turning into another, dot by dot, each at its rank |
| **landing** | how a sheet appears: every dot arrives at its own moment, flashing as it lands |
| **energy** | what a gesture or a wave stirs into the sea; it decays over ~2.8 s (the *afterglow* of the whole field) |
| **shell** | what every page carries, whatever its content (§4) |

## 2. The laws

What makes a thing Plankton. If a new idea breaks one of these, either the idea or the law has to be argued with on purpose.

1. **One cell, one dot.** Everything on screen is the same square, drawn by one fragment per cell, blown up to exact squares.
   No gradients, no smooth edges, no sub-cell positions on screen.
2. **Tone is density, not brightness.** A dark area has few dots, not dim ones. Dots stay crisp (`TONE_BRIGHT`); how many of
   them there are carries the picture.
3. **The dither is fixed to the screen.** One blue-noise map thresholds everything. Content moves *through* it, which is why a
   moving picture shimmers and a turning model never swims.
4. **Every dot has its own life.** Its own breathing phase, its own flicker pace, its own arrival and departure moment. No two
   dots in a region ever do the same thing at the same time.
5. **Nothing pops.** Things arrive the way the loading does: one number runs 0 → 1 with an ease-out, every dot has its own
   moment at which that number reaches it, so most light almost at once and a few come late, flashing. Leaving is the same,
   run backwards. A change is a *melt*, never a cut or a cross-fade.
6. **Touch stirs; stirring decays.** Pointer and gestures put energy into the field, and the field settles back on its own
   clock. The pointer is itself drawn in dots (a ring round a black hole), exactly on the hotspot, never smoothed.
7. **Nothing is scaled.** Shapes change by melting (blending signed distances, or switching dots by rank), not by stretching.
   Edges are never a line: they are a dissolve of dots.
8. **True black.** Dark ground is `#000000` and a dot is either lit or fully off; light is `#fff` with `#000` ink. The
   material is dark-first; light is the same dots inverted, not a second design (see the README, *Theme*).
9. **The home is the reference.** An effect on any page is the home's effect, with the home's numbers, at the home's size
   (§4, *the unit*). A page may add effects for what it shows that the home has no use for; it may not re-tune the home's. (Added
   after a page built on a lookalike of the home's effects was reviewed and removed: §10.)

## 3. Two layers

Lucas's phrase (2026-11-08) was *"duas camadas, como na home. A UI renderiza a interface on demand, mas todo o estilo e as
animações são os mais importantes."* **Confirmed by Lucas on 2026-11-08: the two layers are the surface and the beneath.**

- **The surface** is the style: what the page looks like and how it moves. On the home, the wordmark. It is where nearly all the
  design effort goes (the landing, the flicker, the pointer's push, the pulse, the melts) and it is what the page *lives in*.
- **The beneath** is the interface: what the surface can do, drawn in the same dots at the same place and **rendered on demand**,
  and only then. On the home, the five brand marks, each a link. Every letter is already a link, but you cannot tell which until
  the curtain shows its mark: the beneath is the interface made legible. The curtain, the wave, a tap and keyboard focus bring it
  up, round the pointer or behind the wave's front, and then it goes back.

**Style and animation are the priority; the interface is what gets revealed.** At rest the beneath does not show and never
competes with the surface; when it shows, it shows in the surface's own material, not as a different kind of thing laid on top.

It is built as one more texture in the surface's layout (`buildBrandTexture` on the home), so any other layer can be revealed the
same way: under the curtain each dot switches from surface to beneath at its own moment (§6, *curtain*).

Rules that follow:

1. **A page has a surface and a beneath, and the beneath is its interface**: the links, the controls, whatever can be acted on. A
   page with nothing to act on has an empty beneath, which is allowed, but it is a decision to write down: the curtain and the wave
   then have nothing to reveal and open onto the field's black. The removed `/tebet` was one: Lucas chose no controls beneath
   its clip (2026-11-08).
2. **Both are drawn in the same dots, in the same coordinates and the same texture layout**, or the melt between them is not
   possible.
3. **The beneath appears only on demand**: the curtain, the wave (behind its front), a touch (a tap shows all of it; a hold or a
   drag, the curtain), keyboard focus. It goes back by itself (on touch, after 8 s untouched).
4. **Every element of the beneath is also a real element in the DOM, all the time** (below), so nothing depends on seeing it.

### How it is built: the DOM and the canvas

This is *not* the two layers; it is the rule that makes rule 4 true, and it is why the beneath can be revealed on demand without the
interface ever being missing. (Older comments may call these "layer 1" and "layer 2"; the word
now belongs to surface and beneath.)

```
 the canvas   WebGL. Draws the DOM as dots and gives every dot a life. Owns style and animation. Owns no content.
 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 the DOM      real HTML/SVG/<video>. Laid out by CSS. Owns content, links, focus, hit-testing, screen readers.
```

On the home the DOM is the SVG wordmark with five real links; the canvas is the shader that draws it. With the shader running the
SVG is `opacity: 0`, **not hidden**, so hit-testing, Tab, Enter and screen readers keep working on it.

| | the DOM | the canvas |
|---|---|---|
| it is | the page: semantic elements, laid out by CSS | one `<canvas>` over the page, `aria-hidden` |
| it owns | **what the thing is and where**: text, links, focus order, alt text, size, position, responsiveness | **how it looks and moves**: dots, landing, flicker, curtain, wave, melt, edge, theme change |
| it never | draws a pixel of the look (it is transparent when the canvas runs) | decides layout, holds a link, holds text, or keeps state the DOM would lose |
| without the other | the page works, plainly: the links open | there is no canvas without the DOM: it has nothing to draw |

**On demand, in the second sense.** The canvas holds no interface of its own; it reads the DOM when it needs to. Cheap things are
read every frame (a sheet's box: `getBoundingClientRect()`, so CSS stays the only source of layout). Expensive things only when
they changed (a video frame when a new one is ready, an image once, a rasterised piece of DOM when that DOM changes). Layout is
CSS; looks are Plankton.

**The degradation ladder.** Each rung keeps everything the one above it has, minus something that is only *look*:
1. WebGL + motion: all of this document. 2. `prefers-reduced-motion`: one still frame in dots; no landing, curtain, wave, sea;
system cursor kept (focus on a letter still shows its mark). 3. No WebGL: the DOM alone (the SVG links work).
4. No JS: the DOM alone, as markup.

## 4. The shell

What every Plankton page carries, whatever it shows. A page supplies its **sheets** (and what lies beneath them); the shell is
the same everywhere, which is what makes it one interface. Numbers and reasons for each are in the README (*The curtain*, *The
field*, *Touch*, *Theme*, *Loading*) and the effects in §6.

| piece | what it is | notes |
|---|---|---|
| **the fixed screen** | one screen: nothing scrolls, pans or zooms; hover and touch answer in place | `overflow: hidden`, `touch-action: none`; ctrl+wheel and Safari's `gesture*` cancelled |
| **the field** | the ambient dots: sea, ripple, flicker, twinkle, breath | centred on the sheet, falling off to the edges |
| **the pointer** | a ring of dots round a black hole, on the hotspot, with a gradient that pushes the field | system cursor hidden while live, on fine pointers only (`.live`, `(hover: hover) and (pointer: fine)`) |
| **the click** | the wave: two pulses across the screen | anywhere that is not a control |
| **the curtain** | the pointer opens the surface onto the beneath, oil on water round it | closes 3 s after the pointer rests |
| **the landing** | the sheet fills with dots on the build curve | 8 s the first time in a session, 2.8 s after (`sessionStorage` `cc-boot`, shared by pages; `?boot` forces it) |
| **the pulse** | after 3 s of stillness, every 9 s: the sheet denser, the field thinner and gathered | |
| **the theme switch** | top right, a 44 px real `<button>`, its icon (moon/sun) drawn in dots; the change spreads out from it pixel by pixel | `localStorage` `cc-theme`; follows the system until chosen; the first paint already has the right theme (inline script) |
| **keyboard** | focus brings up the beneath and draws a dotted underline | the DOM element has the focus; the canvas only draws it |
| **touch** | tap: wave. Hold or drag: the curtain, bigger and lifted 24 px off the finger | a hold never opens a link |
| **frame cost** | if frames stay over 26 ms the dots get one device px coarser, twice at most, never back | |
| **the unit** | the dots, the curtain's radius, the pointer's reach are sized in the home's wordmark height (0.85 of it for the curtain, 32 px for the pointer) | so the effects are the home's *size* on every page, not the size of the page's content |

The unit is a rule a page once broke: the removed `/tebet` sized the curtain as a share of its clip. A page does not size the shell.

## 5. Interface elements and their states

How an *actionable* thing is drawn and behaves. The home has two kinds (a link, and the theme switch); the rules are general.

| state | link (a letter, with its mark beneath) | theme switch |
|---|---|---|
| **idle** | the letter, in dots | its icon, in dots, lit in once the landing is over (700 ms) |
| **pointer over it** | the nucleus grows 25 %, the gradient tightens 15 %; the curtain, if open, shows the mark | the same, and its dots brighten (`uHot`) |
| **keyboard focus** | the mark shows, and a dotted underline under it, until focus leaves | the dotted underline; the dots brighten |
| **press / click** | opens the link (a click on a control sends no wave) | changes the theme from where it is |
| **touch** | first tap shows all the marks (and swallows the click); a tap on a revealed mark opens it; a hold or drag never opens | a tap on it is the switch, not a wave |
| **no WebGL** | the SVG letter, cross-dissolving to its mark on hover | the plain SVG icon |

Rules every control follows:
- **A control is a mark**: drawn in the sheet's dots, beneath the surface, in its own place.
- **It answers to its own shape, never its box.** The hit area is the letter or the icon, not the column round it
  (README, *Letters are links*): the `<rect>` boxes are not hit-testable, only the shapes are, and the mark's own box while it shows.
- **It is a real element in the DOM** (an `<a>`, a `<button>`), with its label, focus and keyboard behaviour. The canvas draws it;
  it does not replace it.
- **Its state is a number**, 0 … 1, that moves by a melt or an ease-out and is drawn by the same per-dot moments as everything else.

A known discrepancy in the home: the README and the shader say the gradient also *brightens 30 %* over a link, but `uLink`
is declared and used in the shader and **never set** in `hero.js` (`createScene`'s `draw()`), so it stays 0. The nucleus growing
25 % and the gradient tightening 15 % do work (`state.linkAmt`). Not fixed here: the home was not in scope.

## 6. The animations

Every effect, with the home's numbers, what triggers it, and whether it carries over to a sheet that is not a wordmark. "Where"
names the function or the shader section in `hero.js` (line numbers would rot). The README holds the full tables for the home.

| effect | what you see | trigger | numbers | on a sheet | where in `hero.js` |
|---|---|---|---|---|---|
| **pointer** | a ring of dots round a black hole in a dark moat, on the hotspot; round it a faint gradient that **pushes the field** radially, **bends it sideways at speed**, thins inside, piles a ring just outside, leaves a wake, stretches along the motion, breathes | a fine pointer moving | nucleus 5 px, `HOLE` 0.5, `MOAT` 1.5; gradient `GRAD_R` 0.7 × 32 px, `GRAD_D` 0.5; `PUSH_AMT` 0.6, `DEFLECT` 0.35, `THIN` 0.6, `RING` 0.35, `WAKE` 0.3, `STRETCH` 0.1, `BREATHE` 0.03; gradient on a spring ω30 ζ1, lag ≤ 0.3 × 32 px; presence spring ω20 | yes | `pushAt` (the `PUSH` block), FIELD "the pointer", `update()` |
| **energy and the sea** | a slow swell moves the field; **moving the pointer stirs it**, so it gets larger and livelier round where you moved, then settles | pointer speed; a wave | `energy = energy·e^(−dt/2.8) + presence·(speed/2400)·dt·2.2`; `SEA_AMP` 0.9 cells, `SEA_STIR` 4.0, `SEA_GLOBAL` 1.2, `AFTERGLOW` 2.8 s; a wave sets 0.85 | yes | `update()`, FIELD "calm sea" |
| **flicker, twinkle, breath** | every dot wanders between random brightnesses at its own pace and breathes on its own phase | always | `FLICK_C` 0.8 field, `FLICK_L` 0.4 sheet, `TWINKLE` 0.3; 0.5–2.2 changes/s | yes | FIELD, `flick`, `tw` |
| **curtain** | the pointer opens a soft disc; each dot turns from the surface to the beneath at its own moment, drifting a little and dimming while it does | pointer active (after half the landing), idle 3 s closes it | radius 0.85 wordmark heights, feather 0.35, wobble 0.18; spring ω16 ζ1; in 10/s, out 3/s; rank = ½ blue-noise rank + ½ smooth noise at 2.2/H; soft 0.08, drift 0.05 H, dip 0.6 | yes (needs a beneath) | FIELD "the curtain", "the curtain's reveal" |
| **oil on water** | the surface film (sheet *and* field) is pushed radially out of the curtain, leaving a clean opening and a denser rim | with the curtain | `REPEL` 0.5, `REPEL_W` 0.9, `REPEL_SOFT` 0.12, `REPEL_RIM` 1.6; opens on ω7 ζ0.8, closes on ω3.2 ζ1 | yes | FIELD "oil on water" |
| **wave** | two pulses cross the screen: push, swell, the field thins, a band where the dots' energy is cancelled, **and the beneath shows behind the front** | click or tap on anything that is not a control | speed 1.05 screen heights/s, life 3.2 s, pulses 0.2 s apart (second 0.15 weaker), push 0.008, swell 0.4; reveal rises 0.1, holds to 0.36, returns over 0.5; field thinned 0.65; ≤ 8 rings | yes (the reveal needs a beneath) | `waveAt`, `spawnWave` |
| **landing** | the sheet fills with dots, each at its own moment, flashing as it lands; the sheet is dimmer until the last quarter | page load | the build curve (`buildRate` in `hero.js`; `disk/math.js` holds a copy), `BUILD_GAIN` 1.03, `FLASH` 0.06; 8 s first time, 2.8 s after | yes | `buildProgress`, `boot()` |
| **pulse** | the sheet 30 % denser, the field 45 % thinner and gathered 5 % toward it, peaking at ~7.8 s | 3 s of stillness, every 9 s | `PULSE_L` 0.3, `PULSE_THIN` 0.45, `PULSE_GATHER` 0.05; 6.0–9.6 s of the cycle | yes | `updateLetters` (the pulse part) |
| **theme change** | the loading's fill again, only faster, spreading out from the switch pixel by pixel | the switch | 1.5 s, `1 − (1 − t)^2.4`; rank = 78 % its distance from the switch, the rest noise; soft 0.14 | yes | `setTheme`, `stepTheme`, FIELD "theme" |
| **touch** | tap = wave; hold (> 250 ms) or drag (> 10 px) = the curtain, ×1.4, lifted 24 px | a finger | `HOLD_MS` 250, `TOUCH_SLOP` 10, `TOUCH_CURTAIN` 1.4, `TOUCH_LIFT` 24 | yes | `touchDown`, `touchEnd`, `update()` |
| **letter melt** | one letter flows into its mark as one mass: signed distances blended, the moment rippling across, space bending | the cycle, a tap, a focus | `MORPH_MS` 900–1300, `MELT_RIPPLE` 0.25, `MELT_WARP` 0.06, `MELT_DIP` 0.35 | **no** (wordmark only) | FIELD "a letter's own change" |
| **the cycle's morphs** | letters turn into their marks at random moments, some turn back, then all converge | 3 s of stillness | `SOLO_AT` 0.7–3.6 s, `SOLO_BACK` 0.5, `CONVERGE_AT` 6.2 s | **no** (wordmark only) | `planCycle`, `updateLetters` |

How a motion is made, in one rule: **give each dot a number (its rank, a hash, a noise value), compare it with a slow global
parameter, and let the dot change when the parameter passes it.** Landing, melt, curtain, wave reveal and theme change are that
one trick with different parameters. A new motion should start from it.

## 7. The material

Shared by every profile (the hero's shader is the reference; `disk/engine.js` carries the same numbers).

- **Dots.** One 64×64 blue-noise map thresholds density. A dot's intensity rises smoothly past its threshold (`DOT_FADE` 0.12)
  and is cut to zero below `DOT_FLOOR` 0.3. The home's letters sit on the checkerboard lattice at `DENS_L` 0.72, so coverage is
  at most half the cells.
- **Tone.** Luminance → levels (`black`, `white`, `gamma`) → density (`dens`). Brightness barely moves (`TONE_BRIGHT` 0.75 on the
  disc; the home's marks use 0.5).
- **Palette.** Dark: `#000000` ground, paper dots `#f0efea`, field dots cooler (`FIELD_TINT` 0.9 0.94 1.0). Light: `#ffffff` ground,
  `#000000` ink (no lattice, denser, calmer flicker). There is **no colour** in the home: dots are paper-white or ink.
- **Field.** Free blue noise, no grid, dimmer where the sheet is not. It twinkles, flickers and is displaced by the sea; a wave
  thins it for a moment. Its density is 1 at the sheet's centre and falls off to the edges: **no halo round the sheet**.
- **Sizes.** The home's rule (above, *cell*); if frames stay over 26 ms the dots get one device px coarser, twice at most.
- **Every knob is a query parameter of the same name** (`?dens=0.9`), and lives in the object a page exposes (`__lab.P` on
  `/disk`). Tuning a look is changing a URL.

## 8. What exists

| profile | page | what it is | effects vs the home | files | state |
|---|---|---|---|---|---|
| **hero** | `/` | the wordmark + five brand marks beneath, as links; **and the engine that draws any other sheet** (§15) | **is** the reference | `hero.js` (own inline shader), `walk.js`, `index.html`, `style.css`, `brands.js`, `raster.js` | shipped; the engine is on `plankton-pages`, not merged |
| **plate** | `/disk` | a picture on a card or a disc in **3D**, turned by drag | the field, sea, flicker, landing and wave; **no** pointer push, curtain, pulse or theme | `disk/` (a copy of the lab's `engine.js`, `math.js`) | shipped; the rest of the lab is on `lab-pixel-media` |
| **swarm** | `/swarm` | one set of dots that walks between the home's wordmark, a panel, a picture, a cube, a sphere, a column | the home's look (cells, lattice, blue noise); **not** its effects: a walk, a wave, a drag | `swarm/` | experiment (§14) |

The hero and the disk each carry their own copy of the shader, the build curve and the pointer; there is no shared module.
Consolidating them is §12.

## 9. Building a page on it

A checklist, in order. Steps 1 and 2 are the ones that get skipped and the ones that matter.

1. **Start from the shell (§4), not from the content.** The pointer, the field, the click, the landing, the pulse and the theme
   switch are not decisions to make again. Size them in the home's wordmark height.
2. **Write the DOM first, with no styling of the look.** The real element (`<video>`, `<img>`, an SVG with `<a>`s, a `<button>`),
   its semantics (`aria-label`, `alt`, `poster`), its CSS layout. Open it with the script off: this is rung 3 of the ladder, and it
   must be a fine page. Decide what lies **beneath** (§3): the page's interface, and which of it is a control.
3. **Give the page a canvas** (`position: fixed; inset: 0; image-rendering: pixelated`, `aria-hidden`) and, when it runs, set a
   class on `<html>` (`gl`) that makes the DOM element `opacity: 0`: never `display: none`, never `visibility: hidden`.
4. **Start from the home's code, not from memory of it.** For a 2D page that is now **a sheet in `hero.js`, not a copy** (§15:
   a `<section class="page" data-page>` in `index.html`, and it has every effect the home has); for a 3D plate take `/disk`'s
   engine (§11: there is no shared module with it). A lookalike was tried and rejected (§10).
5. **Compare with the home before saying "the same".** Open both, in **both themes**, and use the pointer, the click, a hold and
   Tab on each. For anything that touches `hero.js`, run `tools/home-parity.js` (§15): the home must come out identical.
6. **Tune with URLs.** Every look decision is a query parameter first; put the winners in the page's defaults.
7. **Put the build's reasons in the page's header comment** (what is the DOM, what is the canvas).
8. **Unlisted by default:** `noindex`, no link from the home page, and a test that says so (`/disk` has one, in
   `disk/test/repo.test.mjs`).
9. **README:** a section for the page, and a row in §8 here. **Verify in a browser, with numbers before pictures** (§13).

## 10. History: the /tebet attempt

On 2026-11-08 a second page was built on the style, `/tebet`: a 548×548, 1.7 s screen recording drawn in dots, flat (2D), its
border dissolving into the field, on a new module that printed a `<video>` as a sheet. Lucas reviewed it, told me to give up on
the video, and then removed it: the page, the module, the unfinished faithful port of the home's effects, and (at his word, "apaga
e mantém só o /disk") the clip from the repository's history. The clip was a recording of someone else's broadcast. Nothing of it
is left here. This section keeps what it taught.

### Lucas's review (2026-11-08)

> *"as bordas precisam ser mais blurry, sem cor ao fundo. Efeitos precisam ser iguais da home do cardozo.cc."*

1. **Borders blurrier.** The dissolve was 10 % of the shorter side; it needed to be wider and softer.
2. **"Sem cor ao fundo"** (no colour in the background). Three things could have been it: (a) a **colour lens**, the curtain
   opened onto the clip in colour; (b) a **grey haze** behind and round the clip: lifted shadows printed the stage's darkness as
   dim dots, and the field gathered round the sheet, so the clip read as a lighter box on the black; (c) the **page colour**: the
   browser pane showed the home in the *light* theme and `/tebet` was dark-only. **Lucas's answer: (b), the grey haze.** What it
   asks of any sheet: the ground round it is the home's true black (law 8), the dissolve ends in dots that are fully off rather
   than dim, and the field has no halo (§7). Check it by counting lit dots outside the dissolve: none beyond the home's own sea.
3. **Effects the same as the home's.** The list below is what the first version got wrong.

### What a lookalike got wrong

The first version drew the home's effects from memory of what they do. Every row differed from the home in a way that was visible
at once. A new page is checked against this list:

- **pointer:** the home's pushes the field, bends it at speed and leaves a wake; the lookalike was a ring and a faint haze.
- **energy:** the home's is stirred by the pointer's *speed* as well as by waves.
- **curtain:** the home's is 0.85 wordmark heights, a feathered wobbling disc whose dots switch by rank + noise; the lookalike's
  was 0.26 of the clip. A page does not size the shell (§4, *the unit*).
- **oil on water:** the home's has the full rim (up to 1.6×); the lookalike's was 0.3 of it.
- **wave:** the home's also **reveals the beneath** behind its front; the lookalike's only thinned and pushed.
- **pulse:** every 9 s of stillness in the home; none in the lookalike.
- **theme:** the home has dark and light with the switch drawn in dots; the lookalike was dark-only.
- **dots:** the home's are `DENS_L` 0.72 on the lattice; the lookalike's were denser, with lifted shadows (the haze).
- **field:** the home's is centred on the wordmark with **no halo**; the lookalike's gathered round the clip.
- **landing:** 8 s the first time, 2.8 s after; the lookalike had only 2.8 s.

Things it added that the home has no use for: the sheet's tone and a dissolving **edge**, a **loop melt** (a clip's last frame
turns into its first, dot by dot), and in the first version **memory** (a dot keeps its light and lets it go), **sparks** and the
**colour lens**. Memory, sparks and colour are *not* in the home and were what the review objected to.

### Decided by Lucas (2026-11-08)

- The two layers are the **surface and the beneath** (§3).
- Nothing lies beneath a clip for now: no controls (sound, pause, replay); the curtain and the wave open onto the field's black.
  If controls are wanted later, §12 item 3 is the way.
- "No colour in the background" is the grey haze, not the dark page.
- `/tebet` is removed, and so is everything under it; only the home and `/disk` stay.

### Open questions for Lucas

1. **The name** Plankton.
2. **What the next page is**, and whether it gets the theme switch as the home does (dark-only was not what Lucas objected to).

### What was learned

Each was a mistake first.

- **A lookalike is not a port.** I read the home's shader, wrote my own pointer, curtain and wave from memory of what they do, and
  every one differed. The fix is not tuning: it is to **copy the code and test that it is still copied** (§12 item 2).
- **Look at the reference next to the page, in both themes.** The home was open in the light theme the whole time; I had only
  looked at the dark one.
- **A screenshot lies about dots.** The pane renders at 2× and the screenshot is shrunk, which averages white dots on black into
  grey. Judge a dot's brightness on a 1:1 crop (overlay a canvas with `image-rendering: pixelated`) or with numbers.
- **The home's "letter" test assumes solid shapes.** `smoothstep(0.02, 0.15, tone)` decides whether a cell is "sheet" or "field";
  on a picture, every mid-tone below 0.15 got part of the field's dim cool tone. For a picture it is `smoothstep(0, 0.05, tone)`.
- **A dark picture needs its own levels**, and the lattice caps white at grey (a checkerboard lights at most half the cells).
- **A mutation script needs its backup checked.** `mktemp` failed in the sandbox, the backups never existed, and the "restore" step
  silently did nothing; the mutations stacked up in the files. `git diff` showed it; `git checkout` fixed it.

## 11. Status: what is not built

Said plainly, so the next session does not rediscover it.

- **There is no shared module.** The hero and the disk each carry their own copy of the shader, the build curve and the pointer
  (`hero.js`, `disk/engine.js`, `disk/math.js`); a test pins the build curve between the disk's copy and nothing else. A new page
  starts from a copy (§9, step 4).
- **Parity is checked for the home only** (§15, `tools/home-parity.js`, in a browser, by hand): nothing stops `/disk`'s copy of a
  constant or shader chunk drifting from `hero.js`.
- **Light theme exists only in the hero.**
- **A sheet can be words from the DOM now, but only big, heavy ones (§15).** The home's shapes are fat (its edge ramp is ~3.6
  cells), so a hairline or a 16 px line melts: a page's text has to be set like the wordmark. Small, legible running text is still
  open; the pixel font and its word-by-word landing exist, on `lab-pixel-media` (`lab/models/text.js`, Jersey 25).
- **Frame cost is not measured on a phone.**
- **The home's README and shader disagree about `uLink`** (§5). Not fixed.

## 12. Next explorations

Written for a session that starts cold. The first two are not optional.

1. **Choose the next page and write down its beneath** (§3), with the theme switch or without it. Nothing below should start
   before the page is the home's interface: it copies the home's code and shell, and is checked against §10's list, side by side in
   both themes.
2. **Parity.** Done for the home itself (§15: `tools/home-parity.js`, eight hashes). Still to do: the same for `/disk`'s copy of
   the shared constants and shader chunks, as text, with a short allow-list of intended differences; it is the test that would
   have caught every row of §10's list, and the first step of the next item.
3. **Controls beneath a media page** (deferred: Lucas said none for now, 2026-11-08). With the layers settled (§3) this is the
   natural beneath of a clip: sound, pause/play, replay as marks, each a real `<button>`, hit-testable on its own shape, revealed by
   the curtain and the wave like the home's links, and focusable by keyboard (a video has nothing focusable by itself).
4. **Consolidate.** One shared module holding the shader chunks (dots, flicker, sea, pointer, wave, curtain, landing, theme), the
   build curve and the blue noise; the hero and the disk import it. Expect the hero to resist: its shader is 400 lines of inline
   coupling to letters.
5. **Per-dot physics.** Widen a state texture read back each frame so dots have an offset or a velocity and *move*: pushed by the
   pointer and the wave with momentum, drifting back on their own springs. The literal reading of "each pixel has a life of its
   own". It is an **addition** to the home's effects, flagged as such (law 9).
6. **Real DOM text, on demand.** Rasterise a heading or a list from the DOM when it changes, hand it as a sheet, land it word by
   word. First move: an `<h1>` as the sheet on a new page; prove the page works with the script off.
7. **Several sheets on one screen, and a sheet as the beneath of another.** *Several sheets, one at a time: done (§15).* Still
   open: two at once (a rect array + an atlas), and the curtain on one card showing another.
8. **A page-to-page transition that is a melt.** *Done as a walk (§15), not a melt:* the old sheet's dots go out and walk to the
   new one's. A melt of the shapes themselves (signed distances blended, as a letter into its mark) between two pages is open.
9. **Audio into the sea.** An `AnalyserNode`'s level into `energy`; the button is a mark (3).
10. **Colour as a token.** If colour is ever wanted, a small named set a design system could own. The home has none today.

## 13. Checking things

- **Tests:** `tools/test.sh` (node, no dependencies): the disk's maths, the shared raster, the disk's page, and the docs (the
  headings, that the README points here, that `tebet/` and `plankton/` stay gone). A test must be able to fail: break the code
  on purpose once and watch it (and check that the backup exists first).
- **Debug:** on the home, `?debug` exposes `window.__hero` (README, *Develop*); `/disk` exposes `window.__lab` (`__lab.P` holds
  every knob, live). `?debug&seed=7&freeze=6` makes the home the same every load; `&demo` adds a throw-away page (§15).
- **Numbers before pictures.** Ring brightness round a wave's centre, lit fraction and mean level of a crop, the cell size and
  count: all read back from the canvas in the page. Then look at an *upscaled* crop, not a downscaled screenshot (§10).
- **Both themes, both pages, side by side**, with the pointer, a click, a hold and Tab on each (§9, step 5).
- **Phone:** the pane's Mobile viewport, or `?debug&dpr=3` on the home.

## 14. Experiment: /swarm, one set of dots

**Round 1 (2026-11-08).** Lucas sent seven references (a glass cube, a sphere with veins, a lit column, a cyclist of dust, a hand
and an orb, a dithered cosmos, a sparse face) and asked to test, in a localhost page, how to render a UI, 3D models, images and
interactions *consistently*, never scrolling, with pixels that reorganise on the transitions *like a drone show*. The first build
drew soft round specks, free on the screen, and moved them with springs.

**Round 2 (the same day), his review:** *"menos areia e mais pixel, não parece um painel, só parece areia mesmo. Como está hoje na
home é perfeito, precisamos só refinar. Adicione ele como ref e faça os outros com base nele, com um botão de switch pra trocar, e
deixa o mouse pra rotacionar 3D e fazer o drop da onda. O que precisa melhorar é a animação dos pixels nas transições, como se
apagassem e "caminhassem" até o próximo local, no caminho mais curto."* That is law 9 again (§2): the lookalike was the soft dust,
and the home was right all along. Round 2 is what stands; the specks, the springs and the swirl are gone.

**Round 3 (the same day): the walk, and the noise.** Lucas chose to refine the walk. Looking at round 2 mid-transition, 80 000 dots
walking dim read as **a grey fog** (the cube dissolved into a cloud that condensed into the panel): nothing in it was a pixel
walking. So the walk was redone so that a few can be followed (below). While it was being built he reminded me: *"na home tem ruído
ao redor da página toda, nas novas animações não."* The field had been gathered round the middle, a Gaussian: it is now the
home's own profile over the **whole page** (§ the model, field).

`swarm/` is still an **experiment**, unlisted, and not the home's interface (it does not carry the shell of §4), but its look is now
the home's.

### The model

**One set of dots (98 304) and nothing else.** A *layer* is a list of target positions for those same dots, one 3D space, a tone
each. The dots are never created or destroyed: a switch tells them to go somewhere else. **Every dot is one cell of the screen's
grid, as on the home**: a crisp square, on the checkerboard lattice, binary (lit or off), dithered by the home's own blue-noise
map, true black. Tone is density (law 2); a dot's own brightness only flickers, as the home's (`FLICK_L` 0.4).

| layer | where the targets come from | built from |
|---|---|---|
| **home** | the wordmark, **from the home's own SVG** (read from `../index.html`), at the home's rule: lattice, `DENS_L` 0.72 | the reference |
| **ui** | a panel of the page's real elements (card, heading, text, buttons): text and lines crisp, one cell thick; the fill a light dither | the DOM (laid out by CSS, read with `getBoundingClientRect`, drawn to a 2D canvas in device px, then dithered cell by cell) |
| **picture** | a picture, dithered by tone (no lattice), relief from tone (z); **any image dropped on the page** (it stays on this machine) | a drawn picture, or the dropped one |
| **cube**, **sphere**, **column** | even and thin: edges two cells wide, a skin at a fixed spacing (a Fibonacci lattice, a threshold on the blue noise), veins as walks, the column's **light as the threshold** so its shading is a dither | maths (`swarm/layers.js`, no DOM) |
| **field** | the last 16 384 dots, in every layer, **over the whole page**: free blue noise, dim and cool, with the home's own profile (`fieldDensity`, hero.js `densityAt` and `lumC`: a floor everywhere, a swell round the middle, a little less in the top and bottom rows). It lies on the screen in no depth: the camera does not turn it, the fog does not dim it, it never walks | the home's role |

The field's numbers were **measured on the home** (the `?debug` crop, in its calm phase, 1:1 cells) and matched: lit cells 1.6 % at the
top-left edge, 2.5 % at the bottom right, 3.7 % just above the wordmark; the level of a lit dot ≈ 0.24 of full. `/swarm` draws
`DUST_SHARE` 3 % of the cells (up to the 16 384 dots there are; on a very large screen it is thinner than the home's), at
`0.44 × (0.9, 0.94, 1.0)`. A test pins the profile to hero.js's own lines.

The flat layers are made by the home's rule: `lit if tone × 0.72 > blueNoise[cell mod 64] + 0.3 × (0.12 × lum + 0.004)` on lattice
sites (`ditherBody`). They are built **for the screen's grid** (the cell, the canvas), so a dot is exactly where the home would put
one. The interface layer is the DOM first (§3, rule 4): real `<button>`s with their hover and focus, transparent (never hidden)
while the canvas runs, `inert` while another layer shows; a hovered element's dots go steady and bright.

### The walk (the transition)

Each dot, **at its own moment** (a wave from the centre, 0.34 s per world unit, plus up to 0.5 s of its own, measured on the dot's
*own* place in the picture it is leaving, so you see the old picture go out from the middle): **goes out where it stands** (the
first 14 % of its walk: lit less and less often, a stutter), then **walks to its place in the next layer along the shortest path,
a straight line, a hop at a time** (18 hops a second, each dot on its own beat; the farther the longer, 0.45 to 1.6 s, never
long), and **lights with a flash when it arrives**, then follows its layer (a turning cube turns). There is no spring and no swirl:
nothing overshoots or curves. Dot *i* of one layer is near dot *i* of the next (every layer is sorted by place, a Morton key over
its own box; a test measures it), so the walks are short and read as flow, not shuffle. A dot that does not move (the field) does
not walk. Switching mid-walk is fine: the walkers hold where they are and set off from there.

**What makes it followable (round 3).** Only **16 % of the dots, the carriers** (a hash of the dot, `walkers`), stay lit on the way,
bright and even (0.95); **the others walk in the dark** (`dim` 0) and light up, with the flash, only where they land. Each carrier
leaves **a trail: the three places it hopped from**, drawn fading (0.52, 0.29, 0.16), the same line, so a fast one is a dotted
streak and a slow one is a pixel stepping; none when its hops are under half a cell. So between two pictures the screen is not a
fog but about 10 000 lit pixels on straight lines with the field behind them: the old picture goes out from the middle, lights
travel, the new one pops in from where they arrive. The trail is more vertices of the same dots (`gl_VertexID / N`), drawn only
while something walks. Knobs, in the URL and live in `__swarm.walk`: `?hop=18` (hops a second), `?walkers=0.16`, `?pause=0.14`
(the share of the walk spent going out), `?dim=0` (how lit the others are), `?trail=3`. The time and hops of a walk live in one
snippet shared by the update and the draw (a test checks neither keeps its own copy).

**Checked as numbers, read back from the GPU** (`__swarm.walkStats()`, ui → cube): carriers 15.8–16.1 % of the walkers at every
moment; every walker within 0.00002 of a cell of the straight line between its two places and never outside the segment (0 of
79 000); going out peaks at 0.4 s (30 000 dots), walking at 0.9 s (79 000, 12 600 of them lit), arrivals from 0.9 s, all settled
by ~2.5 s. Reduced motion (`?still`) never walks: 98 304 of 98 304 settled at once.

### The mouse, the switch, the reference

| | |
|---|---|
| **switch** | ‹ › buttons (and ← →, 1–6): the layer changes; a click never switches |
| **drag** | turns the 3D layers (with a little inertia); the flat ones tilt and spring back |
| **click** | drops the wave: two pulses that push and light what they cross (a click on a control sends no wave, as on the home) |
| **pointer** | a hole in the dots with a push round it; moving it stirs more |
| **ref** | the real home, in a frame over the swarm (R): to compare the two, side by side in time, with the home's own pointer and theme |

### The pixel setting

One slider (and `[` / `]`, and `?pixel=0.5`), 0 to 1: **the size of a cell**, from the home's own (1.5 CSS px, never under 2 device
px) at 0 to **the screen's grid** at 1 (18 CSS px cells, a gap between them, the grid itself faintly visible, `?gridlines=0` hides
it, and the field down to a handful of dots: *the screen's grid with a few pixels*). There is no soft end. A bigger cell is not a
blown-up picture: the layers are built again for it and **the pixels walk to the new cells**. The maths is `swarm/density.js`.

### What it showed, and what is open

- **Showed:** the home's look carries over to a panel, a picture and three 3D shapes without leaving its rules (cells, lattice,
  blue noise, true black), and one dot set can move between them with one trick, as the landing and the curtain do (§6).
- **Open:** (1) a 3D shape is *projected* and snapped each frame, so a turning cube shimmers cell by cell rather than being
  dithered in screen space as `/disk` does: which is right? (2) the panel's text is the browser's, rasterised: at the home's cell a
  16 px line is five cells tall; the home's pixel font (on `lab-pixel-media`) would be more native; (3) only the dark theme; (4) the
  cyclist and the face from the references (dust that falls apart, a figure out of a few dots) are not built; (5) the walk's
  numbers (hops a second, speed, delay, the carriers' share) are first guesses, judged from stills (the pane cannot show motion
  to me): whether 18 hops a second *reads* as walking, and whether dark non-carriers are right or a faint 0.1 (`?dim=`) keeps the
  picture more present, is for Lucas's eye; (6) the trails triple the vertices while something walks (0.16 → 0.45 ms of CPU
  submit per frame on this Mac); on a phone it is not measured; (7) on a very large screen the field is thinner than the home's
  (16 384 dots is all there are).
- **Check it:** in the console `__swarm.step(s)`, `.pause()`, `.goto(i)`, `.wave([x, y])`, `.turn(yaw, pitch)`, `.setRef(on)`,
  `.stats([x, y, w, h])` (lit share and mean level of the canvas or a CSS-px rectangle, read back; compare with the home's
  `?debug` `__hero.crop`), `.walkStats()`, `.walk` (the knobs), `.info()` and `.shot()`; the layers, the setting and the page's
  promises are tested by `tools/test.sh`. The pane may open at 0 × 0: call `.rebuild()` once it has a size.

## 15. The home as an engine: sheets, pages and the walk

**The brief (Lucas, 2026-11-08, after round 3 of /swarm).** *"You should have used the cardozo.cc home as the base, which is how I
already like it: the effects, everything, including the links that show in the background. You only have to copy it, and build the
others from it. On the home there will be an arrow button to each page, and each page will be a part of my portfolio, but don't
worry about that: carry on with the refinement, based on the home. Let's work already with its code, toward deploying the new
version with this documentation."* Law 9 again (§2): `/swarm` drew its own dots (a particle system that only looked like the home);
the home's own shader is the thing to build on. Then, on seeing the first placeholder page ("Work / Coming soon / Back"): *"tchau"*:
it was taken out of the HTML at once. **No page ships.** What is on the branch is the engine that will carry them.

### What changed in `hero.js`, and what did not

The home is **pixel for pixel what it was** (below). The FIELD shader, the compose pass, every effect, the landing, the choreography,
the theme, the touch gestures: untouched. Added:

| | |
|---|---|
| **sheets** | the FIELD pass is a function of a *sheet* (`fieldPass(sheet, target)`): its two faces (surface, beneath: the home's texture layout, `buildMaskTexture`, now given a layout `{w, h, tpu}`; the home's is 90 × 15.75 units at 22 texels/unit), the box it fills on the screen, and its **columns**. The five letters' edges and centres were constants of the shader; they are `uColE[4]`, `uColC[5]` now (the wordmark's own numbers), so a sheet can be cut into other columns or into one |
| **the field says what is the sheet's** | with `uAlpha` the field's alpha is 0 outside the sheet, 0.5 inside its shape where no dot is lit, 1 where one is (the halo of dots on a soft edge counts as the sheet's: when it did not, a ghost of the old letters stayed behind). With `uAlpha` 0, alpha is 1 as it always was |
| **the walk** | `walk.js` (pure, tested) and two passes: `MIX` and the carriers (below) |
| **the arrow** | a second icon in the compose pass, beside the theme switch's (`arrowSd`, `uGo`) |
| **navigation** | `goTo(name)`, the hash, `showDom`; pages are `<section class="page" data-page>` |
| **debug** | `?debug&seed=7&freeze=6` (same every load), `&demo` (a throw-away page); `__hero.pages()`, `.goTo(name)`, `.holdWalk(on, t)`, `.scene.probe(x, y, w, h)` |

### A page

A page is **real DOM first** (§3): a `<section class="page" data-page="name" id="name">` in `index.html` whose box is always 90 : 50
and sized from its own width (`--pw`, so the sheet does not depend on the window), with its words (`data-t`) and links (`<a>`).
Without the script, the arrow opens it by `:target` and the wordmark steps aside; with the script and no WebGL, `hero.js` does the
same with `data-page` on `<html>`; with WebGL the section is transparent (never hidden: hit-testing, focus and screen readers keep
working) and only the page shown is there (`.on`).

Its **sheet** is that DOM drawn in the home's own texture layout (`buildPageMasks`): the words in heavy rounded strokes (900 weight
plus a stroke: the home's shapes are fat, its edge ramp is a few cells wide, so a hairline would melt), and **beneath each link an
arrow** (← for the back link), which the curtain, the wave and keyboard focus reveal exactly as they reveal the home's brand marks
(§3: the beneath, in the surface's own dots). Checked in the pane: the curtain opens under the pointer with its oil-on-water rim and
the arrow shows where the word `BACK` was. A page's links answer as the letters do (the pointer tightens, focus draws the dotted
underline). A sheet built from a page takes ~130 ms on this Mac; they are built when the page is idle after the landing, so the first
walk does not wait for it.

**To add a page:** put its `<section>` (and the arrow `<a class="go" href="#name">` that opens it) in `index.html`, as the comment
there shows; set its words big and heavy in CSS with `calc(var(--pw) * …)`; open it with `?debug&seed=7&freeze=6` and walk to it by
hand (`__hero.goTo("name")`, `__hero.holdWalk(true, 1.5)`); run `tools/home-parity.js` on the home. The arrow's href becomes `#` on a
page (back); with several pages the home needs one arrow each (a row of icons: not built).

### The walk between two sheets

FIELD draws **both** sheets, each as it looks on its own page (every effect acts on both). `MIX` then decides, cell by cell, which one
shows: the old sheet's dot until its moment (it stutters out, lit less and less often), the new sheet's from the moment it lands
(a flash that settles), and nothing in between; the field's noise is whichever sheet has no dot there. `walk.js` says **when**: the
lit cells of the two sheets (read back from their own fields, untouched by the pointer) are sorted by place (a Morton key over each
set's own box, so a small sheet and a big one are paired left with left, top with top) and paired, dot *i* of one with dot *i* of
the other; the wave goes out from the middle of the old picture (0.68 s per screen height + up to 0.5 s of each dot's own), the dot
goes out where it stands for 0.12 s, walks the straight line at 18 hops a second (0.45 to 1.6 s, the farther the longer), and lands.
A dot lit in both sheets at the same cell does not move. Only **16 % of the dots, the carriers**, stay lit on the way, bright, each
with a trail of the three places it hopped from (drawn over the composed screen, one cell each, on the same grid); the rest walk in
the dark (found on `/swarm`, §14: 80 000 dots walking dim read as a grey fog). 8-bit time textures (one texel per cell) carry the
moments; the carriers are `GL_POINTS` from static buffers, so nothing is read back per frame and the whole thing is WebGL1, as the
home is. If the walk's shaders do not build, the home still runs and the page just opens. Reduced motion and no WebGL: no walk.

Measured here (1024 × 768, dpr 2, cell 2 px, the demo page): ~13 000 pairs, ~1 900 carriers, 3.1 s, the start of a walk 60 ms (two
field reads and the pairing), the page's sheet 128 ms. Frame cost during a walk is not measured on a phone.

### The arrow

The theme switch's twin, bottom right: a real 44 px `<a>` (the SVG is only the fallback), its icon drawn in the compose pass in
dots, lit in with the switch, brighter on hover, a dotted underline on keyboard focus. It points → on the home and ← on a page, and
its `href` follows. It is not in the HTML until there is a page to open.

### Parity: the home is the home

`tools/home-parity.js` (paste it into the console of `/?debug&seed=7&freeze=6&theme=dark`, and again with `theme=light`, at 1024 × 768
and dpr 2) hashes the field and the composed canvas in four states: rest, every letter showing its mark (the beneath), a wave on its
way, both. A change to `hero.js` that is meant to leave the home alone must leave all eight as they were. It was needed to be able
to say "unchanged" at all: the first runs differed from load to load until `Math.random`, the clock and the choreography (whose
morphs and pulse run on real time) were pinned, and a stray real pointer over the pane was blocked.

| | rest | marks | marks + wave | wave |
|---|---|---|---|---|
| dark | 85f9c051 · 85a64ec | 26535fb1 · 17d3939 | f5f5ea77 · f1be1a6a | 6a864597 · 4c5b8873 |
| light | dd9028aa · 8a659062 | c7e05df1 · 48c1e20f | 4b7c8b0b · b2165d9b | 78844ebb · fbbd87ae |

(field · composed.) Identical after every step above, in both themes.

### Checked, and not

Checked in the pane: the home identical (above); the walk home → page → home by real clicks on the arrow and by the address (Back,
a deep link `#name`); both themes (ink black on white, black carriers); a phone (375 wide: the page takes the width); the curtain on
a page; no ghost of the old sheet (the lit share of the cells the old letters occupied, once they are gone: 3.93 %, the field's
own, 3.92 %). `tools/test.sh`: the walk's maths (`test/walk.test.mjs`) and the engine's promises as text (`test/pages.test.mjs`),
each shown to fail when the code is broken.

**Open:** (1) **no page has content** and Lucas said not to worry about the portfolio; (2) small, running text does not survive the
home's soft edges: a page's words have to be as big and heavy as the wordmark; (3) one arrow only, so several pages need a row of
them; (4) the walk's feel (hop rate, the share of carriers, the dark non-carriers) is judged from stills; (5) the walk's cost on a
phone, and the 60 ms at its start on a slow one; (6) touch: a tap on the arrow is a plain link (no first-tap reveal); (7) two sheets
on screen at once, and a melt between two pages instead of a walk (§12 7, 8); (8) `/disk` is still its own copy of the shader (§11);
(9) a visitor who opens `#name` gets the page's landing, not a walk from the home: nothing to walk from.
