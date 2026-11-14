#!/bin/sh
# Kopierar appens bibliotek som .mjs till pgtest/lib (för test-tagtool-e2e.mjs) — samma kod,
# bara importvägarna får filändelse. Standard: repots src/lib (tre nivåer upp).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${1:-$HERE/../../../src/lib}
mkdir -p "$HERE/lib"
for f in aes ntag424 tagurl; do
  sed -E 's#from "\./(aes|ntag424|tagurl)"#from "./\1.mjs"#g' "$SRC/$f.js" > "$HERE/lib/$f.mjs"
done
echo "ok: $(ls "$HERE/lib" | tr '\n' ' ')"
