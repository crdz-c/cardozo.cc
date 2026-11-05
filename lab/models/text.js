// Pixel text: a line or two set in Jersey 25 (fonts/, SIL OFL), one pixel of the font = one block of dither cells, and the text
// appears word by word, every pixel of a word landing at its own moment (the hero's build curve, per word) until the text is
// complete.
//
// Jersey 25's grid is 41 pixels to the em (measured: its strokes are 3 to 8 units of em/41; the "25" is its ascender, 25 px high),
// so set at 41 px every pixel of the font is exactly one canvas pixel. The text is rasterised there, thresholded, and each lit
// pixel becomes a *block*: the engine draws a pixel as a whole number of cells (it picks the biggest that fits, or ?px=), snapped to
// the cell grid, and the pixel's own fill (texel.g) lets the dots inside it land one by one, with a flash (texel.b), exactly as the
// hero's letters fill. The sheet has no thickness and no edge: only ink.
//
// ?text=feeling|nostalgic?  (| or \n starts a line)   ?align=center|left   ?leading=1
// ?word=1.1  s a word takes to land   ?gap=0.3  s between words   ?fill=0.3  s a pixel takes to fill in   ?flash=0.2  s of its flash
// ?order=random|ltr  (ltr: a word fills left to right, with some scatter)   ?loop=0  s of rest before it all happens again (0: once)
// The timing knobs are live in lab.source.opts.
import { buildInverse, landTime, pixelState, textTime } from "../math.js";

const U = 41; // px per em at which one pixel of Jersey 25 is one px
const ASC = 25; // its ascender, in pixels (and the cap height is a little under)
const DESC = 6; // its descender
const LEAD = 34; // baseline to baseline, px (× ?leading)
const PAD = 2; // empty pixels all round the text

let fontReady = null;
function loadFont() {
  fontReady ??= (async () => {
    const face = new FontFace("Jersey 25", `url(${new URL("../fonts/Jersey25-Regular.ttf", import.meta.url).href})`);
    await face.load();
    document.fonts.add(face);
  })();
  return fontReady;
}

export default {
  id: "text",
  // a flat sheet that faces you, in the hero's letter density; the engine's pose, thickness and levels do not apply
  params: { spin: 0, rx: 0, ry: 0, size: 0.8, thick: 0, shade: 0, dens: 0.72, black: 0, white: 1, build: 0, px: 0 },

  async create(h, arg = {}) {
    await loadFont();
    const opts = { word: h.num("word", 1.1), gap: h.num("gap", 0.3), fill: h.num("fill", 0.3), flash: h.num("flash", 0.2), loop: h.num("loop", 0) };
    const opt = (k) => arg[k] ?? h.q.get(k); // (the call's options beat the query's)
    const order = opt("order") === "ltr" ? "ltr" : "random";
    const left = opt("align") === "left";
    const leading = Number.isFinite(parseFloat(opt("leading"))) ? parseFloat(opt("leading")) : 1;
    const text = opt("text") ?? "feeling\nnostalgic?";
    const lines = text
      .replace(/\\n|\|/g, "\n")
      .split("\n")
      .map((l) => l.trim().split(/\s+/).filter(Boolean))
      .filter((ws) => ws.length);
    if (!lines.length) throw new Error("text: nothing to set");

    // layout, in font pixels (measured at K× and divided back: the font's advances are whole pixels)
    const K = 8; // supersampling: the text is drawn K× big and each pixel read at its centre, which the canvas's own anti-aliasing
    //              (it fringes and thickens strokes) cannot disturb
    const font = `${U * K}px "Jersey 25"`;
    const mc = document.createElement("canvas").getContext("2d");
    mc.font = font;
    const adv = (s) => Math.round(mc.measureText(s).width / K);
    const lineW = lines.map((ws) => adv(ws.join(" ")));
    const step = Math.round(LEAD * leading);
    const texW = Math.max(...lineW) + 2 * PAD;
    const texH = PAD + ASC + (lines.length - 1) * step + DESC + PAD;

    const CW = (texW + 1) * K;
    const CH = (texH + 1) * K;
    const cv = document.createElement("canvas");
    cv.width = CW;
    cv.height = CH;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.font = font;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    const words = []; // { text, x, base }
    lines.forEach((ws, li) => {
      const x0 = left ? PAD : PAD + Math.round((texW - 2 * PAD - lineW[li]) / 2);
      ws.forEach((word, wi) => words.push({ text: word, x: x0 + (wi ? adv(ws.slice(0, wi).join(" ") + " ") : 0), base: PAD + ASC + li * step }));
    });
    const drawWords = (list) => {
      cx.clearRect(0, 0, CW, CH);
      cx.fillStyle = "#fff";
      for (const w of list) cx.fillText(w.text, w.x * K, w.base * K);
      return cx.getImageData(0, 0, CW, CH).data;
    };

    // the font's pixel grid sits at some phase (mod K) of this canvas: read it off the edges of the whole text
    const all = drawWords(words);
    const litAt = (d, x, y) => d[(y * CW + x) * 4 + 3] >= 128;
    const px = new Array(K).fill(0);
    const py = new Array(K).fill(0);
    for (let y = 1; y < CH; y += 3) for (let x = 1; x < CW; x++) if (litAt(all, x, y) !== litAt(all, x - 1, y)) px[x % K]++;
    for (let x = 1; x < CW; x += 3) for (let y = 1; y < CH; y++) if (litAt(all, x, y) !== litAt(all, x, y - 1)) py[y % K]++;
    const phx = px.indexOf(Math.max(...px));
    const phy = py.indexOf(Math.max(...py));
    const sx = (i) => ((phx + K / 2) % K) + K * i; // the centre of font pixel i
    const sy = (j) => ((phy + K / 2) % K) + K * j;

    // which word each lit pixel belongs to: each word drawn on its own, read at the pixel centres
    const wordOf = new Uint8Array(texW * texH).fill(255);
    const span = []; // per word: min and max x
    words.forEach((w, wi) => {
      const d = drawWords([w]);
      let x1 = 0;
      let x2 = texW;
      for (let j = 0; j < texH; j++) {
        for (let i = 0; i < texW; i++) {
          if (litAt(d, sx(i), sy(j)) && wordOf[j * texW + i] === 255) {
            wordOf[j * texW + i] = wi;
            x1 = Math.max(x1, i);
            x2 = Math.min(x2, i);
          }
        }
      }
      span.push([x2, x1]);
    });
    const nWords = words.length;

    // the blocks: every lit pixel, its word, and the moment (0 … 1 of its word's build) at which it lands
    const data = new Uint8Array(texW * texH * 4);
    for (let i = 0; i < texW * texH; i++) data[i * 4 + 3] = 255;
    const idx = [];
    const word = [];
    const when = [];
    for (let i = 0; i < texW * texH; i++) {
      if (wordOf[i] === 255) continue;
      const w = wordOf[i];
      const [a, b] = span[w];
      const rank = order === "ltr" ? Math.min(1, Math.max(0, ((i % texW) - a) / Math.max(1, b - a)) * 0.8 + Math.random() * 0.2) : Math.random();
      idx.push(i * 4);
      word.push(w);
      when.push(buildInverse(rank)); // the hero's build curve: when a site of this rank has landed
      data[i * 4] = 255; // ink
    }

    function update(t) {
      const o = source.opts;
      const tt = textTime(t, nWords, o);
      for (let b = 0; b < idx.length; b++) {
        const [amt, flash] = pixelState(tt, landTime(word[b], when[b], o), o);
        const i = idx[b];
        data[i + 1] = amt * 255;
        data[i + 2] = flash * 255;
      }
    }

    const asp = texW / texH;
    const ax = asp >= 1 ? 1 : asp;
    const ay = asp >= 1 ? 1 / asp : 1;
    const source = {
      name: "text",
      pixel: true,
      dynamic: true,
      raw: { w: texW, h: texH, data },
      wordOf, // per pixel: its word (255: none)
      plate: { disc: false, ax, ay, hole: 0, half: [ax, ay], pixelGrid: { w: texW, h: texH } },
      opts,
      update,
      words, // [{ text, x, base }] in font pixels
      info: { words: nWords, pixels: idx.length, grid: [texW, texH], phase: [phx, phy], edgesOnGrid: [+(px[phx] / px.reduce((a, b) => a + b, 0)).toFixed(3), +(py[phy] / py.reduce((a, b) => a + b, 0)).toFixed(3)] },
    };
    update(0);
    return source;
  },
};
