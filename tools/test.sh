#!/bin/bash
# The lab's tests. No dependencies: node's built-in runner (node 18+) for the pure logic, raster.js and the repo/docs checks;
# the browser suite (WebGL, pointer events, the font) is a page: it needs a browser, so this serves the repo and says where.
#
#   tools/test.sh            node tests only
#   tools/test.sh --serve    …then serve the repo on :8000 for the browser suite: open http://localhost:8000/lab/test/
#                            (the tab's title says PASS 31/31 or FAIL, and the page lists every test)
set -e
cd "$(dirname "$0")/.."
node --test lab/test/*.test.mjs
if [ "${1:-}" = "--serve" ]; then
  echo
  echo "Browser suite: http://localhost:8000/lab/test/   (Ctrl-C to stop the server)"
  exec python3 -m http.server 8000
fi
echo
echo "Browser suite: run \`tools/test.sh --serve\` (or any static server on the repo root) and open /lab/test/"
