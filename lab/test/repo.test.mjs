// node --test lab/test/*.test.mjs — the lab's files and its documentation agree: the assets are what they claim, every file the
// README names exists, every knob is documented.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { GENERIC_PARAMS } from "../engine.js";
import { MODELS } from "../models/index.js";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const readme = read("README.md").toString();
const labReadme = readme.slice(readme.indexOf("\n## Lab\n"), readme.indexOf("\n## Deploy\n"));

test("the CD sprite is a 1024×1024 RGBA PNG", () => {
  const png = read("lab/media/cd.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1024, "width");
  assert.equal(png.readUInt32BE(20), 1024, "height");
  assert.equal(png[25], 6, "colour type 6: RGBA");
});

test("Jersey 25 is a TrueType font and its licence travels with it", () => {
  const ttf = read("lab/fonts/Jersey25-Regular.ttf");
  assert.equal(ttf.readUInt32BE(0), 0x00010000, "a TrueType font");
  assert.ok(ttf.length > 100_000, "not truncated");
  assert.ok(ttf.includes(Buffer.from("Jersey 25", "utf16le").subarray(0, 18)) || ttf.includes(Buffer.from("Jersey 25")), "its name is in it");
  const ofl = read("lab/fonts/OFL.txt").toString();
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/i);
  assert.match(ofl, /Jersey|Soft Type Project/);
});

test("every file the README's lab tree names exists", () => {
  const tree = readme.slice(readme.indexOf("lab/index.html"), readme.indexOf("**Models, and using the engine elsewhere.**"));
  for (const m of tree.matchAll(/^(lab\/[\w./-]+)/gm)) {
    const p = m[1].replace(/\/$/, "");
    assert.ok(existsSync(new URL(p, root)), `${p} is named in the README but missing`);
  }
  for (const p of ["lab/engine.js", "lab/math.js", "lab/lab.js", "lab/index.html", "lab/LEARNINGS.md", "lab/models/cd.js", "lab/models/text.js", "lab/models/picture.js", "lab/models/index.js", "tools/make-cd.py", "lab/test/index.html"]) {
    assert.ok(existsSync(new URL(p, root)) && statSync(new URL(p, root)).size > 0, `${p} exists and is not empty`);
  }
});

test("every engine knob is documented in the README", () => {
  for (const k of Object.keys(GENERIC_PARAMS)) assert.ok(labReadme.includes(`\`${k}\``), `knob \`${k}\` is not in the README's Lab section`);
});

test("every model's knobs are engine knobs (or the text model's own), and every model has an id and a create()", () => {
  const own = new Set(["px"]); // the text model's cells-per-pixel
  for (const [name, m] of Object.entries(MODELS)) {
    assert.equal(m.id, name, `${name}: the id is the key`);
    assert.equal(typeof m.create, "function", `${name}: create()`);
    for (const k of Object.keys(m.params ?? {})) assert.ok(k in GENERIC_PARAMS || own.has(k), `${name}: unknown knob ${k}`);
  }
});

test("the README's defaults for the CD are the engine's", () => {
  assert.equal(GENERIC_PARAMS.thick, 0.02, "a real CD's thickness (README: 0.02)");
  assert.equal(GENERIC_PARAMS.rx, 26);
  assert.equal(GENERIC_PARAMS.ry, -20);
  assert.equal(GENERIC_PARAMS.black, 0.3);
  assert.equal(GENERIC_PARAMS.white, 0.9);
  assert.equal(GENERIC_PARAMS.dens, 1.2);
  assert.equal(MODELS.cd.params.spin, 40);
  assert.equal(MODELS.text.params.dens, 0.72, "the hero's letter density");
  for (const row of ["| `thick` / `shade` | 0.02 / 0.35 |", "| `rx` / `ry` | 26 / -20 |", "| `black` / `white` / `gamma` | 0.3 / 0.9 / 1 |", "| `dens` | 1.2 |"]) assert.ok(labReadme.includes(row), `the README row ${row}`);
});
