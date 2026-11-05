// cardozo.cc/lab — the page: picks a model and runs the engine (engine.js) on the canvas.
//
//   /lab/                 the CD, in 3D
//   /lab/?model=text      pixel text in Jersey 25, word by word (?text=feeling|nostalgic?)
//   /lab/?src=media/x.mp4 any picture, GIF or video as a card (also: drop a file, ?src=sketch:rings)
//
// window.__lab is the engine's API (P: the knobs, view, load, wave, pose, step, shot, info …) plus MODELS, model(id, arg) and
// text(str). See README, "Lab".
import { createEngine } from "./engine.js";
import { MODELS } from "./models/index.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("scene");
const lab = createEngine({ canvas, query: q });

window.__lab = Object.assign(lab, {
  MODELS,
  model: (id, arg) => lab.useModel(MODELS[id], arg), // switch model at runtime: __lab.model("text", { text: "hello|world" })
  text: (str) => lab.useModel(MODELS.text, { text: str }),
});

const id = q.get("model") || (q.has("src") ? "picture" : "cd");
if (!MODELS[id]) console.error(`no model called ${id} (have: ${Object.keys(MODELS).join(", ")})`);
lab.useModel(MODELS[id] ?? MODELS.cd).then(() => lab.run());
