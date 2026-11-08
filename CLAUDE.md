# cardozo.cc

Lucas Cardozo's site. Everything on it is made of **Plankton**, a pixel material: dots that behave as if each one were alive.
**Read [docs/PLANKTON.md](docs/PLANKTON.md) before changing or adding a page**: its laws (§2, the home is the reference), the two
layers (§3: the **surface** is the style, the **beneath** is the interface, drawn in the same dots and revealed on demand; the DOM
and the canvas are only how it is built), the shell every page carries (§4), the animations with the home's numbers (§6), what
exists and what does not (§8, §11), what the removed `/tebet` taught (§10), and the next explorations (§12).

- Code, comments, docs, commits: English. (Answers to Lucas: Brazilian Portuguese, per his global instructions.)
- `README.md` specifies the home page and holds the file map; `docs/PLANKTON.md` specifies the style.
- **`hero.js` is the engine** (docs §15): the home, and any page as a *sheet* of the same shader, with the dots walking between
  them (`walk.js`). **The home must not change when it does**: run `tools/home-parity.js` (README, *Pages*) in both themes and
  get `identical: true`. No page ships yet (Lucas, 2026-11-08: the placeholder went); `?debug&demo` adds a throw-away one.
- Pages: `/` (`hero.js`, its own shader) and `/disk` (3D; a copy of the lab's engine, whole lab on branch `lab-pixel-media`).
  `/disk` is unlisted: nothing links to it, `noindex`. `/swarm` is an unlisted **experiment** (docs §14): one set of dots, in the home's own look, that
  walks between the wordmark, a panel, a picture and 3D shapes, with a switch, a drag, a wave and a pixel setting; not the home's interface. A video page (`/tebet`) and a 2D module (`plankton/`)
  were built and then **removed, with the clip purged from history**, on Lucas's word (2026-11-08): neither may come back (a test
  checks). What they taught is docs §10.
- Tests: `tools/test.sh` (node 18+, no dependencies). A test must be able to fail: break the code on purpose once and watch it (check
  that your backup exists first).
- Preview: `.claude/launch.json` serves the folder on :8000 (`python3 -m http.server`); ES modules need http, not `file://`.
- Judge dots on a 1:1 crop or on numbers, never on a downscaled screenshot (docs §10, §13). Every look knob is a query parameter.
- "The same as the home" means copied code with the home's numbers and a test that it stays copied, checked side by side with the
  home in **both themes** (docs §9, step 5). A lookalike was tried and rejected.
- A new page starts with the DOM, the real elements, working with the script off, and decides what lies beneath (docs §9).
- GitHub Pages serves `main` on push. Merging into `main` is Lucas's call.
