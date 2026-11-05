// The generic model: whatever you put on the lab (?src=, a dropped or pasted file, a sketch) becomes a card of the picture's own
// proportions, at the engine's default knobs. A URL is an image, an animated GIF or a video (mp4/webm: muted, looped);
// "sketch:<name>" is one of SKETCHES below.

// Sketches draw on the plate's texture (T px square), white on black, `t` in seconds.
export const SKETCHES = {
  // rings that grow out of the middle and fade
  rings(ctx, t, W, H) {
    const m = Math.min(W, H);
    ctx.lineWidth = m * 0.012;
    for (let i = 0; i < 6; i++) {
      const u = (t * 0.25 + i / 6) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${(1 - u) * 0.95})`;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, u * m * 0.45, 0, 7);
      ctx.stroke();
    }
  },
  // a radar sweep: a disc lit by a turning wedge, fading behind it
  sweep(ctx, t, W, H) {
    const g = ctx.createConicGradient(t * 1.2, W / 2, H / 2);
    g.addColorStop(0, "#fff");
    g.addColorStop(0.45, "#000");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.4, 0, 7);
    ctx.fill();
  },
};

export default {
  id: "picture",
  params: {},
  // `what` is a URL, a File, or "sketch:<name>"
  async create(h, what = h.q.get("src")) {
    if (typeof what === "string" && what.startsWith("sketch:")) {
      const fn = SKETCHES[what.slice(7)];
      if (!fn) throw new Error(`no sketch called ${what.slice(7)} (have: ${Object.keys(SKETCHES).join(", ")})`);
      return { draw: fn, name: what, dynamic: true };
    }
    if (!what) throw new Error("picture: nothing to show (give ?src=, or drop a file)");
    const isFile = typeof File !== "undefined" && what instanceof File;
    const url = isFile ? URL.createObjectURL(what) : what;
    const name = isFile ? what.name : what;
    const video = isFile ? what.type.startsWith("video/") : h.VIDEO_RE.test(name);
    return video ? h.loadVideo(url, name) : h.loadImage(url, name);
  },
};
