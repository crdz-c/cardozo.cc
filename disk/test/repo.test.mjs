// node --test disk/test/*.test.mjs — what the /disk page is made of: the CD and nothing else, and no way in from the home page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { GENERIC_PARAMS } from "../engine.js";
import cd from "../models/cd.js";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root)).toString();

test("the CD sprite is a 1024×1024 RGBA PNG", () => {
  const png = readFileSync(new URL("disk/media/cd.png", root));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1024, "width");
  assert.equal(png.readUInt32BE(20), 1024, "height");
  assert.equal(png[25], 6, "colour type 6: RGBA");
});

test("every file the page needs is there", () => {
  for (const p of ["disk/index.html", "disk/disk.js", "disk/engine.js", "disk/math.js", "disk/models/cd.js", "disk/models/picture.js", "disk/media/cd.png", "raster.js", "favicon.png", "favicon.ico", "apple-touch-icon.png", "tools/make-cd.py", "tools/test.sh"]) {
    assert.ok(existsSync(new URL(p, root)) && statSync(new URL(p, root)).size > 0, `${p} exists and is not empty`);
  }
});

test("the page shows the CD and only the CD: one model, dropped files ignored, nothing linked", () => {
  const entry = text("disk/disk.js");
  const imports = [...entry.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["./engine.js", "./models/cd.js"], "it imports the engine and the CD, nothing more");
  assert.match(entry, /drop: false/, "a file dropped on the page is ignored");
  assert.ok(!/MODELS|URLSearchParams|location\.search/.test(entry.replace(/\/\/.*$/gm, "")), "no model switch, and the page reads no query of its own");
  const page = text("disk/index.html");
  assert.ok(!/<a[\s>]/.test(page), "no links on the page");
  assert.ok(!existsSync(new URL("disk/models/text.js", root)) && !existsSync(new URL("disk/fonts", root)), "the text model and its font are not here");
  assert.equal(cd.id, "cd");
});

test("no shortcut: the home page does not link to /disk", () => {
  for (const f of ["index.html", "hero.js", "style.css", "brands.js"]) assert.ok(!/\/disk|disk\//i.test(text(f)), `${f} does not mention /disk`);
});

test("the CD's defaults are the ones it was tuned with", () => {
  assert.equal(GENERIC_PARAMS.thick, 0.02, "a real CD's thickness");
  assert.equal(GENERIC_PARAMS.rx, 26);
  assert.equal(GENERIC_PARAMS.ry, -20);
  assert.equal(GENERIC_PARAMS.black, 0.3);
  assert.equal(GENERIC_PARAMS.white, 0.9);
  assert.equal(GENERIC_PARAMS.dens, 1.2);
  assert.equal(cd.params.spin, 40);
});

test("the README says where the page is and where the rest went", () => {
  const readme = text("README.md");
  assert.match(readme, /\/disk/);
  assert.match(readme, /lab-pixel-media/);
});
