#!/bin/bash
# The tests of /disk (its engine's maths, the shared raster, the page), of /swarm (the layers, the pixel setting, the page) and of
# the docs (they are there, and what was removed stays removed). No dependencies: node's built-in runner (node 18+). The browser tests (WebGL, pointer events, the pixel text) live with
# the lab on the branch lab-pixel-media: this page runs the same engine.
#
#   tools/test.sh
set -e
cd "$(dirname "$0")/.."
node --test disk/test/*.test.mjs swarm/test/*.test.mjs docs/test/*.test.mjs
