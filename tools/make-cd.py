#!/usr/bin/env python3
"""Make lab/media/cd.png: a clean, front-on, concentric CD from a photo-like illustration of a CD held in a hand.

    python3 tools/make-cd.py path/to/cd-with-hand.png [out.png] [--debug DIR]

What it does (OpenCV + numpy only):
  1. finds the hand (skin colours, the biggest blob and what touches it, grown a little to cover its outline);
  2. fits an ellipse to the visible rim and warps the disc to a true circle (the picture is seen a little from the side);
  3. moves the hub so it is concentric with the rim (it sat ~17 px off, which would wobble when the disc spins);
  4. paints over the hand: in the hub by mirroring its good half (the hub is symmetric about the vertical), on the wedges
     by repeating another stretch of the visible wedge sequence, with the seam angles picked where the colours match best;
  5. writes a 1024×1024 RGBA PNG: the disc fills 92 %, everything outside it transparent.
It is a one-off: the numbers below were tuned on one picture. Needs opencv-python (cv2) and numpy.
"""
import sys
import cv2
import numpy as np

OUT = 1024          # output side, px
R = 470.0           # output disc radius, px (92 % of the half side)
HUB_R = 165.0       # px: the hub's outer metal ring (in the circle-warped picture)
POLAR_A, POLAR_R = 4096, 1024   # polar sampling: angle rows × radius columns

args = [a for a in sys.argv[1:] if not a.startswith("--")]
dbg = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
src_path = args[0]
out_path = args[1] if len(args) > 1 else "lab/media/cd.png"

def save_dbg(name, img):
    if dbg:
        cv2.imwrite(f"{dbg}/{name}", img)

bgr = cv2.imread(src_path, cv2.IMREAD_COLOR)
H, W = bgr.shape[:2]
rgb = bgr[..., ::-1].astype(int)
Rc, Gc, Bc = rgb[..., 0], rgb[..., 1], rgb[..., 2]
lum = rgb @ np.array([0.2126, 0.7152, 0.0722])

# ---- 1. the hand
skin = ((Rc > 140) & (Rc - Bc > 45) & (Rc > Gc * 1.1)).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(skin, connectivity=8)
big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
hand = (lab == big).astype(np.uint8)
dist = cv2.distanceTransform(1 - hand, cv2.DIST_L2, 3)
for i in range(1, n):  # slivers of finger or wedge touching the hand
    if i != big and stats[i, cv2.CC_STAT_AREA] > 30 and dist[lab == i].min() < 30:
        hand[lab == i] = 1
hand = cv2.morphologyEx(hand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
hand = cv2.dilate(hand, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))

# ---- 2. the rim: an ellipse through the visible edge points, seen from the hub's hole
hole = np.zeros((H, W), bool)
yy, xx = np.mgrid[0:H, 0:W]
guess = (xx - 281) ** 2 + (yy - 311) ** 2 < 70 ** 2
hole = guess & (lum < 20)
hx, hy = xx[hole].mean(), yy[hole].mean()   # the hub's hole, in the source
pts = []
for th in np.arange(0, 360, 1.0):
    t = np.radians(th)
    last = None
    for r in np.arange(180, 300, 0.25):
        x, y = hx + r * np.cos(t), hy - r * np.sin(t)
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < H):
            break
        if lum[yi, xi] > 30:
            last = r
    if last is None:
        continue
    clear = True
    for rr in (last - 14, last - 6, last, last + 6):
        xi, yi = int(round(hx + rr * np.cos(t))), int(round(hy - rr * np.sin(t)))
        if 0 <= xi < W and 0 <= yi < H and hand[yi, xi]:
            clear = False
    if clear:
        pts.append((hx + last * np.cos(t), hy - last * np.sin(t)))
(ex, ey), (d1, d2), ang = cv2.fitEllipse(np.array(pts, np.float32))
a, b, phi = d1 / 2, d2 / 2, np.radians(ang)
print(f"rim: centre ({ex:.1f}, {ey:.1f}) axes {a:.1f} × {b:.1f} angle {ang:.1f}°, {len(pts)} edge points")

# output → source: the symmetric stretch along the ellipse's axes (keeps the picture's orientation)
Rp = np.array([[np.cos(phi), -np.sin(phi)], [np.sin(phi), np.cos(phi)]])
S = Rp @ np.diag([a, b]) @ Rp.T
o = np.array([OUT / 2, OUT / 2])
A = S / R
t0 = np.array([ex, ey]) - A @ o
M = np.hstack([A, t0[:, None]])
circ = cv2.warpAffine(bgr, M, (OUT, OUT), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP)
hm = cv2.warpAffine(hand * 255, M, (OUT, OUT), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP) > 100

# ---- 3. the hub concentric with the rim, the wedges still radial
# The wedges radiate from the hub's hole, which sits ~17 px off the rim's centre (the picture is in perspective). Moving the hub
# alone would bend them, so each output point (radius r, angle φ about the rim's centre) is read from the source along the
# SAME angle about the hole: the hub ring keeps its size, the wedge band stretches so that it ends exactly on the rim circle.
hq = o + R * np.linalg.solve(S, np.array([hx - ex, hy - ey]))   # the hole's centre in the circle picture
d = hq - o
print(f"hub is {d[0]:+.1f}, {d[1]:+.1f} px off the rim's centre: made concentric")
gx, gy = np.meshgrid(np.arange(OUT, dtype=np.float64), np.arange(OUT, dtype=np.float64))
px, py = gx - o[0], gy - o[1]
rr = np.hypot(px, py)
ux, uy = np.where(rr > 0, px / np.maximum(rr, 1e-9), 1.0), np.where(rr > 0, py / np.maximum(rr, 1e-9), 0.0)
du = d[0] * ux + d[1] * uy
rim = -du + np.sqrt(du * du - (d @ d) + R * R)          # distance from the hole to the rim circle along φ
rho = np.where(rr <= HUB_R, rr, HUB_R + (rr - HUB_R) * (rim - HUB_R) / (R - HUB_R))
mapx, mapy = (hq[0] + rho * ux).astype(np.float32), (hq[1] + rho * uy).astype(np.float32)
circ = cv2.remap(circ, mapx, mapy, cv2.INTER_CUBIC)
hm = cv2.remap((hm * 255).astype(np.uint8), mapx, mapy, cv2.INTER_LINEAR) > 100
save_dbg("1-circle.png", circ)

# ---- 4a. the hub: its right half mirrored over the left (about x = OUT/2 exactly)
flip = np.float32([[-1, 0, OUT], [0, 1, 0]])
mirror = cv2.warpAffine(circ, flip, (OUT, OUT), flags=cv2.INTER_CUBIC)
mirror_hm = cv2.warpAffine((hm * 255).astype(np.uint8), flip, (OUT, OUT), flags=cv2.INTER_LINEAR) > 100
hub = rr < HUB_R + 8
# the hub is symmetric about the vertical (tick and pads), so its whole left half is the right half mirrored: the thumb left
# smudges in it that a patch would not hide. Only the ring's outer edge, where the wedges begin, is patched under the hand.
fill_hub = ((rr < HUB_R - 3) & (gx < OUT / 2)) | (hub & (cv2.dilate(hm.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0))
work = circ.copy()
good = fill_hub & ~mirror_hm
work[good] = mirror[good]
left_over = fill_hub & mirror_hm
if left_over.any():  # a few px the mirror cannot give either
    work = cv2.inpaint(work, (left_over * 255).astype(np.uint8), 4, cv2.INPAINT_TELEA)
print("hub pixels the mirror could not give (inpainted):", int(left_over.sum()))

# ---- 4b. the wedges: repeat another stretch of the visible sequence, in polar coordinates
pol = cv2.warpPolar(circ, (POLAR_R, POLAR_A), tuple(o), R, cv2.INTER_CUBIC | cv2.WARP_POLAR_LINEAR).astype(np.float32)
pm = cv2.warpPolar((hm * 255).astype(np.uint8), (POLAR_R, POLAR_A), tuple(o), R, cv2.INTER_LINEAR | cv2.WARP_POLAR_LINEAR) > 100
c0, c1 = int(POLAR_R * 180 / R), int(POLAR_R * 460 / R)   # the wedge band, hub and rim line left out
rows_bad = np.nonzero(pm[:, c0:].any(axis=1))[0]
i1, i2 = int(rows_bad.min()), int(rows_bad.max())
print(f"hand covers {i1 * 360 / POLAR_A:.1f}° … {i2 * 360 / POLAR_A:.1f}° of the wedges")
N = POLAR_A
def rowmean(r0, r1):
    idx = np.arange(r0, r1) % N
    return pol[idx][:, c0:c1].mean(axis=0)
SEAM = 6                      # rows compared on each side
PAD = int(N * 30 / 360)       # the fill may grow this far beyond the hand, to find better seams
best = None
visible = np.ones(N, bool)
visible[i1:i2 + 1] = False
for delta in range(int(N * 100 / 360), int(N * 260 / 360)):
    # the donor window [s+delta, e+delta] must lie in the visible rows
    cost_a = {}
    for s in range(i1 - PAD, i1 + 1, 4):
        d0 = (s + delta) % N
        if not visible[np.arange(d0, d0 + (i2 - s)) % N].all():
            continue
        cost_a[s] = float(((rowmean(s - SEAM, s) - rowmean(s + delta, s + delta + SEAM)) ** 2).mean())
    if not cost_a:
        continue
    cost_b = {}
    for e in range(i2, i2 + PAD + 1, 4):
        d1_ = (e + delta) % N
        if not visible[np.arange(d1_ - (e - i1), d1_ + 1) % N].all():
            continue
        cost_b[e] = float(((rowmean(e + 1, e + 1 + SEAM) - rowmean(e + delta - SEAM + 1, e + delta + 1)) ** 2).mean())
    if not cost_b:
        continue
    s_best = min(cost_a, key=cost_a.get)
    e_best = min(cost_b, key=cost_b.get)
    total = cost_a[s_best] + cost_b[e_best]
    if best is None or total < best[0]:
        best = (total, delta, s_best, e_best)
total, delta, s, e = best
print(f"fill rows {s}..{e} ({(e - s) * 360 / N:.0f}°) from {delta * 360 / N:.0f}° further on; seam error {total ** 0.5:.1f}/255")

filled = pol.copy()
idx = np.arange(s, e + 1)
filled[idx % N] = pol[(idx + delta) % N]
# soften each seam over a few rows
for centre, direction in ((s, 1), (e + 1, -1)):
    for j in range(-SEAM, SEAM):
        row = (centre + j) % N
        t = (j + SEAM) / (2 * SEAM)
        t = t * t * (3 - 2 * t)
        donor, keep = filled[row], pol[row]
        filled[row] = (keep * (1 - t) + donor * t) if direction == 1 else (donor * (1 - t) + keep * t)
back = np.nan_to_num(cv2.warpPolar(filled, (OUT, OUT), tuple(o), R, cv2.INTER_CUBIC | cv2.WARP_POLAR_LINEAR | cv2.WARP_INVERSE_MAP))
ang_map = (np.degrees(np.arctan2(py, px)) % 360) / 360 * N
in_fill = (ang_map >= s) & (ang_map <= e)
use = in_fill & (rr >= HUB_R - 2) & (rr <= R + 2)
wedge = work.astype(np.float32)
wedge[use] = back[use]
# hub ↔ wedge hand-over: blend over a few px at the hub's outer edge
t = np.clip((rr - (HUB_R - 2)) / 12, 0, 1)[..., None]
res = work.astype(np.float32) * (1 - t) + wedge * t
res = np.clip(res, 0, 255).astype(np.uint8)
save_dbg("2-clean.png", res)

# ---- 5. a transparent sprite: the disc, anti-aliased, nothing outside it
alpha = np.clip((R - 1.5 - rr) / 1.5 + 0.5, 0, 1)
rgba = np.dstack([res, (alpha * 255).astype(np.uint8)])
rgba[alpha == 0, :3] = 0
cv2.imwrite(out_path, rgba)
print("wrote", out_path)
