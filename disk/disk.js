// cardozo.cc/disk — the CD, in the hero's dots, on a 3D disc you turn. Only the CD: no other model, and a file dropped on the
// page is ignored. Drag it (it glides on when let go), scroll or pinch to move in and out, click or tap to send the hero's wave.
//
// The engine (engine.js, math.js) and the CD (models/cd.js, media/cd.png) are the lab's, saved whole on the branch
// lab-pixel-media with the other models (pixel text, pictures), its browser tests and what was learned. See the README, "/disk".
import { createEngine } from "./engine.js";
import cd from "./models/cd.js";

const canvas = document.getElementById("scene");
try {
  const disk = createEngine({ canvas, drop: false });
  window.__lab = disk; // (for tuning in the console: __lab.P holds the knobs, every one is also a query parameter)
  disk.useModel(cd).then(() => disk.run());
} catch (err) {
  // no WebGL: the disc, flat
  console.warn(err);
  canvas.remove();
  const img = new Image();
  img.className = "flat";
  img.alt = "A compact disc";
  img.src = new URL("./media/cd.png", import.meta.url).href;
  document.body.appendChild(img);
}
