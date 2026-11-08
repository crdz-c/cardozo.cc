// swarm/density.js — the pixel setting. One number, 0…1, from the fine dust of the references to the screen's own grid with a
// few squares lit. Pure maths, no DOM: the shader gets its values from here and a test pins the two ends.
//
//   0  fine      soft round specks, free on the screen, every one of them drawn                    (the references)
//   1  grid      big square cells snapped to the screen's grid, one dot in twenty drawn, the grid
//                itself faintly visible behind them                                                (the screen, with a few pixels)
//
// Tone stays density at every setting (law 2): a cell adds up the dots that fall in it, so a dense area saturates it and a sparse
// one leaves it dim or off. The dust is lifted at the grid end, or the few pixels it leaves would be too faint to see.
export const FINE = 1.3; // CSS px: the cell at 0
export const GRID = 18; // CSS px: the cell at 1
export const KEEP_MIN = 0.05; // share of dots drawn at 1

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The cell, in CSS px. Geometric: each step of the slider changes the size by the same factor. */
export const cellSize = (g) => FINE * Math.pow(GRID / FINE, clamp01(g));
/** The share of dots drawn (thinned by rank, so the same dots always stay). */
export const keepFraction = (g) => 1 - (1 - KEEP_MIN) * smooth(0.3, 1, g);
/** 0: positions are free; 1: every dot sits at the centre of its cell on the screen's grid. */
export const snapAmount = (g) => smooth(0, 0.25, g);
/** 0: a round soft speck; 1: a square that fills its cell. */
export const squareness = (g) => smooth(0.1, 0.6, g);
/** What one dot adds to its cell: a cell takes many more dots than a pixel does, so each adds about a third as much (it has to,
 *  or every shape fills in solid white and the tone, which is the density, is lost). */
export const alphaGain = (g) => 1 - 0.65 * smooth(0.05, 0.6, g);
/** Tone is raised to this power: below 1 it lifts the dim dots (the dust) so the few pixels left can be seen. */
export const tonePower = (g) => 1 - 0.45 * smooth(0.3, 1, g);
/** How much brighter the dust is drawn (it is a twentieth of a twentieth of the screen). */
export const dustBoost = (g) => 1 + 2 * smooth(0.4, 1, g);
/** How visible the screen's own grid is, behind the dots: nothing until the cells are big, then a faint tile per cell. */
export const gridAmount = (g) => smooth(0.55, 1, g);

export function pixelSetting(g) {
  return {
    cell: cellSize(g), keep: keepFraction(g), snap: snapAmount(g), square: squareness(g),
    gain: alphaGain(g), power: tonePower(g), dust: dustBoost(g), grid: gridAmount(g),
  };
}
