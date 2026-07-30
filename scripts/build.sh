#!/bin/bash

# Build the browser bundle: esbuild bundles app.js and its npm imports
# (Chart.js, chartjs-plugin-zoom) into a single minified bundle.js.
# esbuild comes from mise; run after `npm ci`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
esbuild app.js --bundle --format=iife --minify --outfile=bundle.js
echo "built bundle.js"
