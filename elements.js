// cardozo.cc — scene elements: things laid out by the DOM and rendered *into* the dot field.
//
// The page keeps its real DOM (layout, links, focus, screen readers). When WebGL runs, those elements are
// made transparent and this module rasterises them into one screen-sized "UI mask" that the shaders read:
//
//   R  text: the element's own web font, rasterised at device pixels (coverage × density). The field pass
//      samples it once per cell, so type is drawn with exactly the field's square cells.
//   G  shapes: 0.25 marks an element's area (the field quiets down under it); above that, a shape whose
//      dots are drawn on the field's lattice at density (G − 0.25) / 0.75 (borders, SVG fills, …).
//   B  image tone: an image becomes a density map for the same dots.
//
// Every draw uses additive blending ("lighter") in a pure channel colour, so it only touches its channel.
// The wordmark is not drawn here: it has its own texture (distance fields, flips).

const AREA = 0.25;

export function createElements(onChange) {
  const list = [];
  return {
    list,
    // { id, kind: "text" | "box" | "svg" | "image" | "wordmark", node, density = 1, hover = false,
    //   area = false, outline = false, src }
    add(spec) {
      const el = { density: 1, hover: false, area: false, outline: false, ...spec };
      if (el.kind === "image") {
        el.img = el.node instanceof HTMLImageElement ? el.node : new Image();
        if (el.src) el.img.src = el.src;
        if (!el.img.complete) el.img.addEventListener("load", () => onChange?.(), { once: true });
      }
      list.push(el);
      return el;
    },
  };
}

const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);

// Draw a node's text in its own computed font, glyph by glyph at the exact boxes the browser laid them out in
// (letter-spacing, transforms, wrapping), skipping screen-reader-only text. Returns the text's box (client px).
function drawText(ctx, node, value) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  ctx.fillStyle = `rgb(${value},0,0)`;
  ctx.textBaseline = "alphabetic";
  let box = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t.parentElement.closest(".sr-only")) continue;
    const cs = getComputedStyle(t.parentElement);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const upper = cs.textTransform === "uppercase";
    const size = parseFloat(cs.fontSize);
    const text = t.data;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) continue;
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      const glyph = upper ? ch.toUpperCase() : ch;
      const m = ctx.measureText(glyph);
      const asc = m.fontBoundingBoxAscent ?? size * 0.8;
      ctx.fillText(glyph, r.left, r.top + asc);
      const top = r.top + asc - (m.actualBoundingBoxAscent ?? size * 0.7);
      const bottom = r.top + asc + Math.max(0, m.actualBoundingBoxDescent ?? 0);
      const right = r.left + m.width;
      box = box
        ? { left: Math.min(box.left, r.left), right: Math.max(box.right, right), top: Math.min(box.top, top), bottom: Math.max(box.bottom, bottom) }
        : { left: r.left, right, top, bottom };
    }
  }
  return box;
}

function drawImage(ctx, el, r, dpr, hr) {
  const img = el.img;
  if (!img || !img.complete || !img.naturalWidth) return;
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const o = off.getContext("2d", { willReadFrequently: true });
  o.drawImage(img, 0, 0, w, h);
  const px = o.getImageData(0, 0, w, h);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3]) / 255;
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = lum * el.density;
    d[i + 3] = 255;
  }
  o.putImageData(px, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, Math.round((r.left - hr.left) * dpr), Math.round((r.top - hr.top) * dpr));
  ctx.restore();
}

// Rasterise every element into `canvas` (device pixels covering `hero`). `cell` is the size of a
// field cell in device px: borders are one cell wide.
export function rasterise(list, canvas, hero, dpr, cell) {
  const lineCss = cell / dpr;
  const hr = hero.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(hr.width * dpr));
  canvas.height = Math.max(1, Math.round(hr.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.setTransform(dpr, 0, 0, dpr, -hr.left * dpr, -hr.top * dpr); // draw in client coordinates

  for (const el of list) {
    if (el.kind === "wordmark" || !el.node) continue;
    const r = el.node.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const shape = `rgb(0,${byte(AREA + (1 - AREA) * el.density)},0)`;

    if (el.area || el.kind === "image") {
      ctx.fillStyle = `rgb(0,${byte(AREA)},0)`;
      ctx.fillRect(r.left, r.top, r.width, r.height);
    }
    if (el.outline) {
      ctx.strokeStyle = shape;
      ctx.lineWidth = lineCss;
      ctx.strokeRect(r.left + lineCss / 2, r.top + lineCss / 2, r.width - lineCss, r.height - lineCss);
    }
    if (el.kind === "text") el.textBox = drawText(ctx, el.node, byte(el.density));
    else if (el.kind === "svg") {
      const vb = el.node.viewBox.baseVal;
      ctx.save();
      ctx.translate(r.left, r.top);
      ctx.scale(r.width / (vb.width || r.width), r.height / (vb.height || r.height));
      ctx.translate(-vb.x, -vb.y);
      ctx.fillStyle = shape;
      el.node.querySelectorAll("path").forEach((p) => ctx.fill(new Path2D(p.getAttribute("d"))));
      ctx.restore();
    } else if (el.kind === "image") drawImage(ctx, el, r, dpr, hr);
  }
  return canvas;
}

// The rects (client coordinates) of the elements a pointer can hover, for hit-testing.
export function hoverTargets(list) {
  return list.filter((el) => el.hover && el.node).map((el) => ({ el, rect: el.node.getBoundingClientRect() }));
}
