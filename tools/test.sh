#!/bin/bash
# The /disk page's tests. No dependencies: node's built-in runner (node 18+). The browser tests (WebGL, pointer events, the pixel
# text) live with the lab on the branch lab-pixel-media: this page runs the same engine.
#
#   tools/test.sh
set -e
cd "$(dirname "$0")/.."
node --test disk/test/*.test.mjs
