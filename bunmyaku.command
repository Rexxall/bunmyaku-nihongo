#!/bin/sh
# macOS / Linux: double-click (or run) to start Bunmyaku with the demo course pack and open the browser.
# Put your own pack directory after --content, or set BUNMYAKU_CONTENT before running.
cd "$(dirname "$0")" || exit 1
exec python3 -m bunmyaku --content "${BUNMYAKU_CONTENT:-examples/demo-pack}" --open "$@"
