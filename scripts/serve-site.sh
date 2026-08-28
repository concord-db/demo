#!/usr/bin/env bash
# Assembles the landing page and both demos into site/ and serves it, matching
# the layout that .github/workflows/deploy-pages.yml deploys to GitHub Pages.
set -euo pipefail

port="${1:-8000}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ ! -d cross-camera/node_modules ]; then
  echo "Installing cross-camera dependencies..."
  (cd cross-camera && npm install)
fi

echo "Building cross-camera demo..."
(cd cross-camera && npm run build -- --base=/cross-camera/)

echo "Assembling site/..."
rm -rf site
mkdir -p site
cp .nojekyll index.html landing.css site/
cp -R event-localization site/event-localization
rm -rf site/event-localization/tests site/event-localization/scripts
cp -R cross-camera/dist site/cross-camera

echo "Serving http://localhost:${port}/ (Ctrl+C to stop)"
exec python3 -m http.server "$port" --directory site
