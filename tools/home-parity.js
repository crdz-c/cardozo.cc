// tools/home-parity.js — the home, pixel for pixel. Paste into the console of the home opened as
//   /?debug&seed=7&freeze=6&theme=dark      (and again with theme=light)
// with the window at a fixed size (the numbers in docs/PLANKTON.md §15 were taken at 1024 × 768, dpr 2). It waits for the build,
// stops the choreography, then hashes the field (one pixel per cell, before the compose pass) and the composed canvas in four
// states: at rest, every letter showing its mark (the beneath), a wave on its way, and both. A change to hero.js that is meant to
// leave the home alone must leave all eight hashes as they were. Resolves to a JSON string.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fnv = (s) => {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 16777619);
    }
    return (x >>> 0).toString(16);
  };
  const H = window.__hero;
  if (!H) throw new Error("open the home with ?debug&seed=7&freeze=6");
  for (let i = 0; i < 300 && !document.documentElement.classList.contains("ready"); i++) await wait(100);
  H.finish();
  H.state.lastInput = 1e15; // the choreography stays paused: nothing moves by itself
  // a stray pointer (the real mouse over the window) must not stir anything: its events are stopped before the page's listeners
  ["pointermove", "pointerdown", "pointerup", "pointercancel", "touchstart"].forEach((t) => window.addEventListener(t, (e) => e.stopImmediatePropagation(), true));
  const calm = () => {
    const s = H.state;
    Object.assign(s.e, { on: false, str: 0, sv: 0, vx: 0, vy: 0 });
    Object.assign(s.cur, { amt: 0, rep: 0, rv: 0, vx: 0, vy: 0, tk: 0 });
    Object.assign(s, { nuc: 0, energy: 0, linkAmt: 0, focusAmt: 0 });
    Object.assign(s.go, { amt: 0, dur: 0, hot: 0 }); // (the arrow to the next page is new: the home is compared without it)
  };
  const marks = (v) => H.letters.forEach((L) => { L.from = L.to = v; L.dur = 0; });
  const wave = (on) => { H.state.waves = on ? [{ x: innerWidth * 0.42, y: innerHeight * 0.5, t0: H.state.time - 0.9, k: 1 }] : []; };
  marks(0);
  await wait(1200); // (the switch's icon lights in over 0.7 s; a letter that was mid-morph is put back at once)
  marks(0);
  await wait(300);
  const both = () => (calm(), { field: fnv(H.crop(0, 0, innerWidth, innerHeight, 1)), shot: fnv(H.shot()) });
  const out = { theme: document.documentElement.getAttribute("data-theme"), cell: H.cell(), size: [innerWidth, innerHeight], dpr: H.dpr() };
  out.rest = both();
  marks(1); await wait(300); out.marks = both();
  wave(true); await wait(300); out.marksWave = both();
  marks(0); await wait(300); out.wave = both();
  wave(false);
  // the home as it was before the pages (hero.js at 8d8b8f9, 1024 × 768, dpr 2, seed 7, freeze 6, cell 2 px)
  const EXPECTED = {
    dark: { rest: ["85f9c051", "85a64ec"], marks: ["26535fb1", "17d3939"], marksWave: ["f5f5ea77", "f1be1a6a"], wave: ["6a864597", "4c5b8873"] },
    light: { rest: ["dd9028aa", "8a659062"], marks: ["c7e05df1", "48c1e20f"], marksWave: ["4b7c8b0b", "b2165d9b"], wave: ["78844ebb", "fbbd87ae"] },
  }[out.theme];
  const same = innerWidth === 1024 && innerHeight === 768 && H.dpr() === 2;
  out.differs = same ? Object.keys(EXPECTED).filter((k) => out[k].field !== EXPECTED[k][0] || out[k].shot !== EXPECTED[k][1]) : "not 1024 × 768 at dpr 2: nothing to compare";
  out.identical = same && out.differs.length === 0;
  return JSON.stringify(out);
})();
