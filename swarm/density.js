// swarm/density.js — the pixel setting. One number, 0…1: the size of a cell, from the home's own to the screen's grid with a few
// squares lit. Pure maths, no DOM. There is no "sand" end: every dot is a square cell on the screen's grid, as on the home.
//
//   0  the home's cell: ~1.5 CSS px (never under 2 device px), the dots as fine as the wordmark's
//   1  the grid: 18 CSS px cells, so few of them are lit; the grid itself faintly visible behind them
//
// A bigger cell is not a blown-up picture: the layers are built again for it (the dither is made on the new grid), so tone is
// still density at every setting (law 2), and the pixels walk from the old cells to the new ones.
export const HOME_CELL = 1.5; // CSS px: the home's cell at its biggest (hero.js: clamp(wordmark height / 80, 0, 1.5))
export const GRID = 18; // CSS px: the cell at 1
export const DUST_SHARE = 0.03; // share of the cells the field's dots light, over the whole page: the home's mean (hero.js: lumC = 0.018 + 0.05 × density; measured on the home: 1.6% at the top-left edge, 2.5% bottom right, 3.7% by the wordmark)

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The cell, in CSS px. Geometric: each step of the slider changes the size by the same factor. */
export const cellCss = (g) => HOME_CELL * Math.pow(GRID / HOME_CELL, clamp01(g));
/** The cell in device px, a whole number and never under 2 (the home's rule). */
export const cellPx = (g, dpr = 1) => Math.max(2, Math.round(cellCss(g) * dpr));
/** The gap between big cells, so the grid reads; none for the fine ones, which touch, as the home's do. */
export const gapPx = (cell) => (cell >= 8 ? Math.max(1, Math.round(cell * 0.09)) : 0);
/** How visible the screen's own grid is, behind the dots: nothing until the cells are big, then a faint tile per cell. */
export const gridAmount = (g) => smooth(0.5, 1, g);
/** The share of the field's dust drawn: a few per cent of the cells, whatever the cell. */
export const dustKeep = (cols, rows, dustCount) => Math.min(1, (DUST_SHARE * cols * rows) / dustCount);
