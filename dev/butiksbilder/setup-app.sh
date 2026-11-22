#!/usr/bin/env bash
# Bygger appen för webben (react-native-web) så att butiksbilderna kan tas från den riktiga appen.
# Ändringarna görs i en egen kopia (git worktree) – aldrig i main.
#
#   dev/butiksbilder/setup-app.sh [ref]     ref = commit eller gren att avbilda (standard origin/main)
#
# Resultat: $APP_DIR/dist (standard ../tappass-butiksbilder-app/dist bredvid repot), som harness/lib.cjs läser.
# Ta bort kopian efteråt: git worktree remove --force ../tappass-butiksbilder-app
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${APP_DIR:-$(cd "$REPO/.." && pwd)/tappass-butiksbilder-app}"
REF="${1:-origin/main}"

if [ -e "$APP" ]; then
  echo "Finns redan: $APP"
  echo "Ta bort den först: git worktree remove --force \"$APP\""
  exit 1
fi

git -C "$REPO" fetch -q origin
git -C "$REPO" worktree add --detach "$APP" "$REF"
cd "$APP"

# NFC och safe area finns inte i webbläsaren: egna attrapper (window.__nfcTap läser en "tagg")
mkdir -p shots
cp "$HERE/app/index.shots.js" "$HERE/app/nfc-shim.js" "$HERE/app/safe-area-shim.js" shots/
cp "$HERE/app/metro.config.js" metro.config.js

# Plattform väljs med ?os=ios|android i adressen (global.__SHOT_OS__), annars Platform.OS.
# Platform.select täcks inte – lägg till här om appen börjar använda det.
grep -rlE '\bPlatform\.OS\b' App.js src | xargs -r sed -i -E 's/\bPlatform\.OS\b/(global.__SHOT_OS__ || Platform.OS)/g'

node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.main = "shots/index.shots.js";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
const a = JSON.parse(fs.readFileSync("app.json", "utf8"));
a.expo.web = { output: "single", bundler: "metro" };
fs.writeFileSync("app.json", JSON.stringify(a, null, 2) + "\n");
'

npm ci --no-audit --no-fund
npx expo install react-dom react-native-web @expo/metro-runtime
CI=1 npx expo export --platform web --output-dir dist

echo "Klart: $APP/dist"
