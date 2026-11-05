#!/usr/bin/env python3
"""Draws the site's favicon: the wordmark's own "C", in pixels, dissolving to the right the way the dot field does.

    python3 tools/make-favicon.py            (needs Pillow and node; run from the repo root)

It reads the C's outline from index.html, rasterises it, and dithers it with the site's own 64x64 blue-noise map
(raster.js), so the icon is made of the same material as the page. The solid left side of the C is the letter; its
terminals and the dust drifting off them to the right are the field. Writes favicon.ico (16, 32, 48), favicon.png (64)
and apple-touch-icon.png (180). Pure black ground, paper dots, on purpose: it reads on a light or a dark tab strip.
"""
import json, math, re, struct, subprocess, sys
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PAPER = (240, 239, 234)
INK = (0, 0, 0)
SS = 16  # supersampling for the glyph's coverage

# ------------------------------------------------------------------ the C's outline, from index.html
html = (ROOT / "index.html").read_text()
d = re.search(r'<path data-l="C" d="([^"]+)"', html).group(1)
tok = re.findall(r"[MCLZ]|-?\d+(?:\.\d+)?", d)


def flatten(tok, steps=24):
    pts, i, cur = [], 0, (0.0, 0.0)
    while i < len(tok):
        c = tok[i]
        i += 1
        if c == "M" or c == "L":
            cur = (float(tok[i]), float(tok[i + 1]))
            i += 2
            pts.append(cur)
        elif c == "C":
            x1, y1, x2, y2, x3, y3 = (float(v) for v in tok[i : i + 6])
            i += 6
            x0, y0 = cur
            for k in range(1, steps + 1):
                t = k / steps
                u = 1 - t
                pts.append((u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3,
                            u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3))
            cur = (x3, y3)
        elif c == "Z":
            pass
    return pts


OUTLINE = flatten(tok)
XS = [p[0] for p in OUTLINE]
YS = [p[1] for p in OUTLINE]
X0, X1, Y0, Y1 = min(XS), max(XS), min(YS), max(YS)

# ------------------------------------------------------------------ the site's blue-noise map (64x64, 0..255)
BLUE = json.loads(subprocess.check_output(
    ["node", "-e", "import('./raster.js').then(m=>console.log(JSON.stringify(Array.from(m.blueNoise()))))"], cwd=ROOT))
assert len(BLUE) == 64 * 64


def blue(x, y, ox=0, oy=0):
    return (BLUE[((y + oy) % 64) * 64 + (x + ox) % 64] + 0.5) / 256


def smoothstep(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def coverage(n, margin):
    """The C's coverage per pixel on an n x n grid (0..1), centred, `margin` pixels clear around it."""
    s = (n - 2 * margin) / (X1 - X0)
    ox = (n - (X1 - X0) * s) / 2 - X0 * s
    oy = (n - (Y1 - Y0) * s) / 2 - Y0 * s
    big = Image.new("L", (n * SS, n * SS), 0)
    ImageDraw.Draw(big).polygon([((x * s + ox) * SS, (y * s + oy) * SS) for x, y in OUTLINE], fill=255)
    small = big.resize((n, n), Image.BOX)
    cov = [[small.getpixel((x, y)) / 255 for x in range(n)] for y in range(n)]
    return cov, (X0 * s + ox, X1 * s + ox)


def blur(cov, n, r):
    """A box blur, for the halo the dust is drawn from."""
    out = [[0.0] * n for _ in range(n)]
    for y in range(n):
        for x in range(n):
            tot = cnt = 0
            for yy in range(max(0, y - r), min(n, y + r + 1)):
                for xx in range(max(0, x - r), min(n, x + r + 1)):
                    tot += cov[yy][xx]
                    cnt += 1
            out[y][x] = tot / cnt
    return out


def draw(n, margin=None, solid=0.42, dust=0.55):
    """An n x n icon: black ground, the C in paper dots, dissolving to the right."""
    margin = margin if margin is not None else max(1, round(n * 0.1))
    cov, (xa, xb) = coverage(n, margin)
    halo = blur(cov, n, max(1, round(n / 11)))
    img = Image.new("RGB", (n, n), INK)
    for y in range(n):
        for x in range(n):
            u = (x + 0.5 - xa) / (xb - xa)              # 0 at the C's left edge, 1 at its right
            keep = 1 - smoothstep(solid, 1.0, u)         # solid on the left, dissolving towards the right
            p = cov[y][x] * (0.10 + 0.90 * keep ** 0.75)  # the letter's own pixels thin out
            p += (1 - cov[y][x]) * halo[y][x] * dust * smoothstep(solid - 0.1, 1.05, u) * 1.6  # dust drifts off to the right
            th = blue(x, y, 5, 11)
            if p > th:
                tone = 0.42 + 0.58 * min(1, 0.4 * keep + 0.7 * cov[y][x])  # dissolved pixels are dimmer, like the field's
                img.putpixel((x, y), tuple(round(c * tone) for c in PAPER))
    return img


def ico(images):
    """A .ico whose entries are PNGs (any browser since IE9 / Vista)."""
    blobs = []
    for im in images:
        b = BytesIO()
        im.save(b, "PNG", optimize=True)
        blobs.append(b.getvalue())
    head = struct.pack("<HHH", 0, 1, len(images))
    off = 6 + 16 * len(images)
    ent = b""
    for im, blob in zip(images, blobs):
        w, h = im.size
        ent += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), off)
        off += len(blob)
    return head + ent + b"".join(blobs)


if __name__ == "__main__":
    sizes = [16, 32, 48]
    icons = {n: draw(n) for n in sizes}
    (ROOT / "favicon.ico").write_bytes(ico([icons[n].convert("RGBA") for n in sizes]))
    draw(64).save(ROOT / "favicon.png", optimize=True)
    # the home-screen icon: a 36-pixel grid at 5x (crisp pixels), centred on the ground
    base = draw(36).resize((180, 180), Image.NEAREST)
    base.save(ROOT / "apple-touch-icon.png", optimize=True)
    if "--preview" in sys.argv:
        sheet = Image.new("RGB", (16 * 8 + 32 * 8 + 48 * 8 + 90, 48 * 8), (60, 60, 60))
        x = 6
        for n in sizes:
            sheet.paste(icons[n].resize((n * 8, n * 8), Image.NEAREST), (x, 0))
            x += n * 8 + 6
        sheet.save(ROOT / "favicon-preview.png")
    print("wrote favicon.ico (16, 32, 48), favicon.png (64), apple-touch-icon.png (180)")
