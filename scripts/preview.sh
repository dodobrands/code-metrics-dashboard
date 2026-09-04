#!/bin/bash

# Build the dashboard locally with real metrics and serve it, so charts can be
# validated without deploying. Data comes straight from the code-metrics HTTP API
# (the same JSON `codemetrics get` returns) — no private CLI install needed.
#
# Credentials come from the environment, or 1Password (vault Mobile) as a
# fallback so a signed-in `op` needs no setup:
#   CODEMETRICS_URL    service base URL (required)
#   CODEMETRICS_TOKEN  a read token; else read from op
#
# Everything the build writes — the stamped pages, data/, bundle.js — is
# gitignored, so a local build never leaves the checkout dirty.
#
# Usage: bash scripts/preview.sh   (or `mise run preview`); PORT overrides 8000.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${CODEMETRICS_URL:?CODEMETRICS_URL is required}"
if [ -z "${CODEMETRICS_TOKEN:-}" ]; then
    CODEMETRICS_TOKEN=$(op read "op://Mobile/code-metrics DAP READ_TOKEN/credential")
fi
export CODEMETRICS_URL CODEMETRICS_TOKEN

echo "Fetching metrics from $CODEMETRICS_URL …"
bash scripts/build-apps.sh

npm ci --silent
bash scripts/build.sh # esbuild → bundle.js

PORT="${PORT:-8000}"
echo "Dashboard built → http://localhost:$PORT  (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
