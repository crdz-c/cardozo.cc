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
> **Experiment in progress:** `/swarm` (§14), a different way to render everything (an interface, a picture, 3D) with one set of
> dots that move between layers like a drone show, with a **pixel setting** from fine dust to the screen's grid. Unlisted, not the
> home's interface.

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
| **hero** | `/` | the wordmark + five brand marks beneath, as links | **is** the reference | `hero.js` (own inline shader), `index.html`, `style.css`, `brands.js`, `raster.js` | shipped |
| **plate** | `/disk` | a picture on a card or a disc in **3D**, turned by drag | the field, sea, flicker, landing and wave; **no** pointer push, curtain, pulse or theme | `disk/` (a copy of the lab's `engine.js`, `math.js`) | shipped; the rest of the lab is on `lab-pixel-media` |
| **swarm** | `/swarm` | one set of dots told to become an interface, a picture, a cube, a sphere, a column; click for the next | **not** the home's effects: a spring model, free specks at pixel 0, the screen's grid at pixel 1 | `swarm/` | experiment (§14) |

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
4. **Start from the home's code, not from memory of it.** There is no shared module (§11): copy the hero's shader chunks and
   constants for the effects the page needs, or take `/disk`'s engine for a 3D plate. A lookalike was tried and rejected (§10).
5. **Compare with the home before saying "the same".** Open both, in **both themes**, and use the pointer, the click, a hold and
   Tab on each. Then run the parity test (§12 item 2: not written yet).
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
- **No parity test against `hero.js`.** Nothing stops a shared constant or shader chunk drifting.
- **Light theme exists only in the hero.**
- **A sheet is a wordmark or a picture; it cannot yet be text from the DOM.** Printing real DOM text on demand (rasterise on
  change, then print) is the missing half of "the UI renders the interface on demand". The pixel font and its word-by-word landing
  exist, on `lab-pixel-media` (`lab/models/text.js`, Jersey 25).
- **Frame cost is not measured on a phone.**
- **The home's README and shader disagree about `uLink`** (§5). Not fixed.

## 12. Next explorations

Written for a session that starts cold. The first two are not optional.

1. **Choose the next page and write down its beneath** (§3), with the theme switch or without it. Nothing below should start
   before the page is the home's interface: it copies the home's code and shell, and is checked against §10's list, side by side in
   both themes.
2. **Write the parity test**: the shared `const` lines and shader chunks of a page equal `hero.js`'s as text, with a short
   allow-list of intended differences. It is the test that would have caught every row of §10's list, and the first step of the
   next item.
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
7. **Several sheets, and a sheet as the beneath of another.** A rect array + an atlas; the curtain on one card showing another.
8. **A page-to-page transition that is a melt.** The old page's last frame melts into the new page's first.
9. **Audio into the sea.** An `AnalyserNode`'s level into `energy`; the button is a mark (3).
10. **Colour as a token.** If colour is ever wanted, a small named set a design system could own. The home has none today.

## 13. Checking things

- **Tests:** `tools/test.sh` (node, no dependencies): the disk's maths, the shared raster, the disk's page, and the docs (the
  headings, that the README points here, that `tebet/` and `plankton/` stay gone). A test must be able to fail: break the code
  on purpose once and watch it (and check that the backup exists first).
- **Debug:** on the home, `?debug` exposes `window.__hero` (README, *Develop*); `/disk` exposes `window.__lab` (`__lab.P` holds
  every knob, live).
- **Numbers before pictures.** Ring brightness round a wave's centre, lit fraction and mean level of a crop, the cell size and
  count: all read back from the canvas in the page. Then look at an *upscaled* crop, not a downscaled screenshot (§10).
- **Both themes, both pages, side by side**, with the pointer, a click, a hold and Tab on each (§9, step 5).
- **Phone:** the pane's Mobile viewport, or `?debug&dpr=3` on the home.

## 14. Experiment: /swarm, one set of dots

Lucas's brief (2026-11-08), after sending seven references (a glass cube, a sphere with veins, a lit column, a cyclist of dust, a
hand and an orb, a dithered cosmos, a sparse face): *render more kinds of thing, with movement; the background darker and less
granular; test some in a localhost page; be organic and 3D; define how to render UI, 3D models, images and interactions so that
they are consistent; we never scroll; each layer (curtain) of pixels renders its context, and **the pixels reorganise on the
transitions, like a drone show**; swap what is shown at each click, to test the layer (loop)*. Then: **a setting for the pixel
density**; at one end the references, at the other *just the screen's grid with a few pixels*.

`swarm/` is that test. It is an **experiment**, not the home's interface: it does not carry the shell of §4, and at pixel 0 it
breaks laws 1 and 3 on purpose (dots are free specks, not cells of one fixed dither). The comparison with the home is the point.

### The model that makes the kinds of thing consistent

**There is one set of dots (98 304) and nothing else.** A *layer* is a list of target positions for those same dots, in one 3D
space, with a tone each (density carries the picture; law 2 still holds). The dots are never created or destroyed: a click tells
them to go somewhere else. Every kind of content is just a different way of producing targets:

| layer | where the targets come from | built from |
|---|---|---|
| **ui** | a bitmap of the page's real elements (heading, text, buttons), sampled in proportion to tone | the DOM (laid out by CSS, read with `getBoundingClientRect`, drawn to a 2D canvas, then sampled) |
| **cosmos** | a picture, sampled by tone, with relief from tone (z) | a drawn picture, or **any image dropped on the page** (it stays on this machine) |
| **cube**, **sphere**, **column** | points on edges, corners and faces; on a skin with veins; on a lit, fluted column (density follows a light) | maths (`swarm/layers.js`, no DOM) |
| **dust** | the last 16 384 dots, the same in every layer: a sparse, dim background | the field's role, with far less grain than the home's |

The interface layer is the DOM first (docs §3, rule 4): the buttons are real `<button>`s with their hover and focus, transparent
(never hidden) while the canvas runs, `inert` while another layer is showing.

### Movement: why it reads as a drone show

- **Dot i in one layer is near dot i in the next**, in the same relative place: each layer's points are sorted by a Morton key
  over its own bounding box, so the transition is a coherent flow and not a shuffle (a test measures it).
- Each dot is a **spring** toward its target with its own stiffness and damping (a little overshoot, then it settles), and a
  **swirl** while it is far from home, so paths curve. A dot in flight glows. Speed is limited.
- Each dot leaves the old target **at its own moment**: a wave from where you clicked (0.34 s per world unit) plus noise (0.5 s).
- It runs on the GPU (a position texture and a velocity texture, updated every frame) and **retargets at any moment**: click
  again mid-flight and the swarm turns round.
- On top: a pointer that is a hole in the dots with a push round it (moving it stirs more), a ring running out from each click,
  a slow breath and twinkle per dot, a small camera that follows the pointer. `prefers-reduced-motion` (or `?still`): the dots
  jump to their places and nothing moves.

### The pixel setting

One slider (and `[` / `]`, and `?pixel=0.5`), 0 to 1. **0** is the references: round soft specks, free on the screen. **1** is *the
screen's grid with a few pixels*: big square cells (18 CSS px) snapped to the grid, one dot in twenty drawn, the grid itself
faintly visible behind them (`?gridlines=0` hides it), the dust lifted so the few lit cells can be seen. In between, the cell
grows geometrically and each step changes snap, squareness, thinning and brightness smoothly. Tone stays density at every
setting: a cell adds up the dots that fall in it. The maths is `swarm/density.js` (pure, tested at both ends and for direction).

### What it showed, and what is open

- **Showed:** one dot set can be a UI, a picture and two kinds of 3D under the same rules, and the transition between any two is
  the same trick, as the home's landing and curtain are (§6). The pixel setting works on all of them with no change to the layers.
- **Open:** (1) is this the home's material or a sibling? (it has no lattice and no blue-noise threshold at pixel 0); (2) the
  interface layer needs real states beyond hover (focus, press), and the 3D layers have no hit-testing yet; (3) text is the
  browser's, rasterised: the home's pixel font (on `lab-pixel-media`) would be more native; (4) the cyclist and the face (dust
  that falls apart, a figure out of a few dots) are not built: they are the same machinery with another source; (5) cost on a
  phone is not measured.
- **Check it:** `__swarm.step(s)`, `.pause()`, `.goto(i, [x, y])`, `.stats()` (lit share and mean level, read back) and `.shot()` are
  in the console; the layers and the setting are tested by `tools/test.sh`.
