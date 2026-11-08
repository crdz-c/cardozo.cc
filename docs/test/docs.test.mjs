// node --test docs/test/*.test.mjs — the style's docs are there and say what they must, and what was removed stays removed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const text = (p) => readFileSync(new URL(p, root)).toString();

test("the docs name the style and carry their sections", () => {
  const doc = text("docs/PLANKTON.md");
  assert.match(doc, /^# Plankton/m);
  for (const part of ["The laws", "Two layers", "surface and the beneath", "The shell", "Interface elements and their states", "The animations", "What exists", "Status: what is not built", "Next explorations", "Open questions for Lucas"]) {
    assert.ok(doc.includes(part), `section: ${part}`);
  }
});

test("the README and CLAUDE.md point at the docs", () => {
  assert.match(text("README.md"), /docs\/PLANKTON\.md/);
  assert.match(text("CLAUDE.md"), /docs\/PLANKTON\.md/);
});

test("/tebet and plankton/ stay removed (Lucas, 2026-11-08): no folder, no clip, and no page mentions them", () => {
  for (const dir of ["tebet/", "plankton/"]) assert.ok(!existsSync(new URL(dir, root)), `there is no ${dir} folder (the clip was a recording of someone else's broadcast)`);
  for (const f of ["index.html", "hero.js", "style.css", "brands.js", "disk/index.html", "disk/disk.js"]) {
    assert.ok(!/tebet|plankton\//i.test(text(f)), `${f} does not mention /tebet or plankton/`);
  }
});
