// The CD, as a reusable asset: a disc with a hole, the sprite that goes on it, and how it is shown (a three-quarter pose, spinning
// about its own axis, a real CD's thickness). media/cd.png is made by tools/make-cd.py from a photo of a CD held in a hand
// (the hand taken out, the disc made a true circle, the hub concentric with the rim), 1024², the disc at 92 % of the side.
//
// To use it in another page:  const lab = createEngine({ canvas });  await lab.useModel(cd);  lab.run();
export const CD = {
  hole: 0.118, // the hole's radius, × the disc's (measured on the sprite; a real CD's is 0.125)
  half: 1.0964, // the sprite's half side, × the disc's radius
  src: new URL("../media/cd.png", import.meta.url).href,
};

export default {
  id: "cd",
  params: { spin: 40 }, // deg/s: one turn in 9 s (the rest are the engine's defaults, tuned on this CD)
  async create(h) {
    const s = await h.loadImage(CD.src, "media/cd.png");
    s.name = "cd";
    s.plate = { disc: true, ax: 1, ay: 1, hole: h.q.has("hole") ? h.num("hole", 0) : CD.hole, half: [CD.half, CD.half] };
    return s;
  },
};
