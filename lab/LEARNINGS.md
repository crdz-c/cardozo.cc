# What the lab taught us

Notes from building `lab/` (the hero's dot material on 3D models), 2026-11-05. Each one is something that was not obvious, with
what to do about it. The README's "Lab" section says how things work; this says why they are the way they are, what was tried and
dropped, and how to check them.

## Turning a picture into dots

- **Tone is density, and the CD's tones are all the same.** Its body sits at luminance 0.5–0.72 (median 0.61): pastels. Printed as
  they are, the whole disc is one grey. Levels fix it: `black` 0.3 / `white` 0.9 stretch the body over the dots' range, and the
  yellow and light-blue wedges saturate to a solid checkerboard while the grey ones stay at ~half. Measure a new picture first
  (percentiles of its luminance) and set `black`/`white` from them; a high-contrast picture wants `black=0&white=1`.
- **Let density carry the tone, not brightness.** The hero's marks dim their dots to 0.5 for dark tones; on a picture that reads as
  mud. `TONE_BRIGHT` 0.75 keeps the dots crisp and lets their *number* say how dark it is.
- **The checkerboard lattice caps coverage at 50 %.** Bright areas sit on it (dots never fuse: the hero's look); `dens` above 1
  makes the brightest tones saturate to a solid checkerboard instead of flattening the whole range. `lattice=0` prints free blue
  noise: denser, a stipple.
- **The dither is fixed to the screen.** That is what makes a moving picture shimmer through it, and it is why the model can turn
  without anything swimming.

## 3D without a mesh

- **One ray per dither cell, analytic hits.** A disc is two planes, an outer cylinder and an inner one (the hole); a card is a box.
  The CD's rim and the wall of the hole, seen across it, come for free and read well in dots.
- **Sample the texture on the front plane unconditionally, outside every `if`.** Then the texture's UV is continuous across the
  screen and the hardware derivatives pick the right mip. Sampling only where the ray hit made the silhouette pixels blur.
  Mipmaps plus anisotropic filtering keep a slanted face clean; the texture must be a power of two for that (WebGL1).
- **A zero-thickness box does not intersect.** A sheet needs a hair of thickness (1e-4) and its walls hidden, or it vanishes.
- **Check the thickness edge-on, with a number.** At 0.03 of the radius it looked "almost double" and measured 1.75× a real CD
  (edge width over diameter: 0.0175 against 0.01). Measure: field and lattice off, `dens` high, pose the disc edge-on (`ry` 90) and
  take the lit extent. 0.02 gives 0.0111.
- **Perspective moves the front face.** The face is nearer the camera than the plate's centre by half the thickness; anything that
  must land on exact cells (the pixel text) adds that to the camera's distance.

## Fluid turning

- **Rotate the wanted pose about the world's axes** (left-multiply a quaternion: y for dx, x for dy), and let the shown pose follow
  with `1 − exp(−dt·k)` (k 26 while dragging, 14 gliding). It is fluid at 30, 60 and 120 Hz and never jerks at the start.
- **Release velocity from the last ~50 ms.** A running average of the drag's angular speed; if the pointer rested before letting
  go, there is no glide. Measured: a 160 px flick over 120 ms leaves 5.4 rad/s, glides ~80° more and stops by ~2.5 s at friction 4.
  Friction 3.2 glided too far.
- **A tap is a press that does not move** (4 px, 10 on touch, under 450 ms): that is what sends the wave, so turning and waving
  share one gesture surface. Scroll down = move in, pinch apart = move in, as on the hero.

## The wave

- **Ported as is, and it works on 3D for free** because every cell samples the scene from a displaced position: the model ripples.
  Measured on the CD: the dot level of the 110–160 px band falls from 61 to 16 as the energy-cancel ring passes, and the ring is
  at 210–260 px half a second later.
- **There is nothing to reveal.** The hero's wave shows the marks under the wordmark; here only the push, the density swell, the
  thinning of the field and the dark ring remain.

## The CD asset (`tools/make-cd.py`)

- The photo is in perspective: the rim is an **ellipse** (axes 230 × 246, tilted 73°), fitted to edge points found by rays from the
  hub, skipping the ones near the hand. One affine warp makes it a circle. The fit residual is 0.2 %: it is a real ellipse.
- **The hub sat 17 px off the rim's centre.** Spinning around the rim made the hub orbit; spinning around the hub made the rim
  wobble. Moving only the hub bent the wedges into S-curves. The fix is a **radial re-parameterisation**: each output point is read
  from the source along the *same angle about the hole*, the hub ring keeping its size and the wedge band stretching to end on the
  rim circle. Wedges stay straight and the two circles are concentric.
- **Under the hand**: the hub is symmetric about the vertical, so its left half is the right half mirrored (patching only the hand's
  pixels left smudges). The wedges are a sequence of colours by angle, so the hidden 150° is filled by repeating another stretch of
  it, the seam angles searched (shift, start, end) for the best colour match; a seam in a wedge sequence just looks like another
  wedge edge. Mirroring the whole half would have been seamless but plainly symmetric.
- Gemini (`agy`) could not be used: it asked for the Google login in the sandbox. OpenCV did it in 3 s, deterministically, from the
  photo itself. A generated CD would not have been *this* CD.

## Pixel text (`models/text.js`)

- **Jersey 25's grid is 41 pixels to the em** (the "25" is its ascender's height in pixels). Found by rendering at 400 px and
  histogramming the lengths of lit runs: peaks at 49, 39, 59, 29 … = multiples of 9.756 = 400/41. At 41 px, one font pixel is one
  canvas pixel and the advances are whole pixels.
- **Do not threshold at 41 px.** The canvas's anti-aliasing fringes and thickens strokes (alpha 1–250 around every edge), so a
  threshold gave ragged pixels and 3533 lit ones. Draw at 8× (328 px), find the grid's phase from the edges (100 % of them fall on
  one phase), and read each pixel at its centre: 3162 clean pixels.
- **A font pixel is a whole number of cells, and the sheet's edge sits on a cell boundary** (a sub-cell shift of the centre,
  `uOff`), or the dither cuts pixels in two and they shimmer. The engine takes the biggest number of cells that fits `size`.
- **Word by word comes from the hero's build curve per word.** Every pixel has a random rank; it lands when the word's fill passes
  it (the inverse of the build table). Its own fill (0 → 1 in `fill` s) drives the dots inside it by their blue-noise rank, and a
  flash decays from landing: the hero's mechanism, one level up. The three numbers per pixel travel in the texture's r, g, b and
  are read with NEAREST (blending them across pixels would smear arrival times).

## Working here (tooling traps)

- **A hidden browser pane runs no animation frames, `img.decode()` never settles, and a screenshot may be stale.** The lab loads
  images with `onload`, and everything is checked with `__lab.step(ms)` (advance the clock and draw), `performance.now` stubbed to
  a virtual clock for pointer tests, and, to *see* exact pixels, the canvas POSTed (`toDataURL`) from the page to a ten-line Python
  receiver on `127.0.0.1` and read as a file. Numbers first (band levels, extents), then pictures.
- **`preview_start name=` reads `.claude/launch.json` of the session's primary folder**, which only changes when the turn ends;
  until then start `python3 -m http.server <port> --directory <repo>` in the background and `preview_start url=…`.
- **The Bash sandbox blocks the network by default**: `git push` needs `github.com` allowed, `gh` fails TLS verification (open the
  PR from github.com), fonts come from `raw.githubusercontent.com` (the OFL font and licence of `google/fonts`).

## Open choices

The CD's auto-spin (40°/s), its home pose (26° / −20°), the back face (the art mirrored, × 0.82), no coupling of drag speed to the
sea's energy, and the text's density (0.72, the hero's letters), size and timing (`word` 1.1 s, `gap` 0.3 s) were picked by eye in
a hidden pane and measured, not yet judged on a retina screen or a trackpad.
