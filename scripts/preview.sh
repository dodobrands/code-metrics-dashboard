#!/bin/bash

# Build the dashboard locally with real metrics and serve it, so charts can be
# validated without deploying. Fetches straight from the code-metrics
# HTTP API (same data `codemetrics get` returns) — no private codemetrics CLI install needed.
#
# Credentials come from the environment, or 1Password (vault Mobile) as a
# fallback so a signed-in `op` needs no setup:
#   CODEMETRICS_URL    service base URL (required)
#   CODEMETRICS_TOKEN  a read token; else read from op
#
# Usage: bash scripts/preview.sh   (or `mise run preview`); PORT overrides 8000.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# the build tool fills index.html's roadmap region in place; restore the
# tracked template on exit so a local build never leaves it dirty (and the
# generated markup can't be committed by accident).
trap 'git checkout -- index.html 2>/dev/null || true' EXIT

: "${CODEMETRICS_URL:?CODEMETRICS_URL is required}"
if [ -z "${CODEMETRICS_TOKEN:-}" ]; then
    CODEMETRICS_TOKEN=$(op read "op://Mobile/code-metrics DAP READ_TOKEN/credential")
fi

echo "Fetching metrics from $CODEMETRICS_URL …"
# data/ holds only generated (gitignored) files, so it's absent on a fresh clone.
mkdir -p data
# The service 502s intermittently — retry on any transient error.
curl -fsS --retry 5 --retry-all-errors --retry-delay 3 \
    -H "Authorization: Bearer $CODEMETRICS_TOKEN" \
    "$CODEMETRICS_URL/metrics?repo=dodobrands/dodo-mobile-ios" >data/raw.json

swift run --package-path Tools/DashboardBuild build data/raw.json
swift run --package-path Tools/DashboardBuild build-roadmap
rm -f data/raw.json

npm ci --silent
bash scripts/build.sh # esbuild → bundle.js

PORT="${PORT:-8000}"
echo "Dashboard built → http://localhost:$PORT  (Ctrl-C to stop)"
python3 -m http.server "$PORT" # not exec: let the EXIT trap restore index.html
