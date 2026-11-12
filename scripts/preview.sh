#!/bin/bash

# Build the dashboard locally with real metrics and serve it, so charts can be
# validated without deploying. Data comes straight from the code-metrics HTTP API
# (the same JSON `codemetrics get` returns) — no private CLI install needed.
#
# Credentials come from the environment, or 1Password (vault Mobile) as a
# fallback so a signed-in `op` needs no setup:
#   CODEMETRICS_URL    service base URL (required)
#   CODEMETRICS_TOKEN  a read token; else read from op
#   KAITEN_TOKEN       the roadmap's Kaiten token; else read from op
#   KAITEN_URL         Kaiten API base; else the repository variable, via gh
# Without the Kaiten pair the preview still builds, with the roadmap hidden.
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
if [ -z "${KAITEN_TOKEN:-}" ]; then
    KAITEN_TOKEN=$(op read "op://Mobile/KAITEN_TOKEN/credential" || true)
fi
# The deploy reads the same repository variable.
if [ -z "${KAITEN_URL:-}" ]; then
    KAITEN_URL=$(gh variable get KAITEN_URL --repo dodobrands/code-metrics-dashboard || true)
fi
export CODEMETRICS_URL CODEMETRICS_TOKEN KAITEN_TOKEN KAITEN_URL

# The bundle first, as on deploy: the pages link it under a hash of its content.
npm ci --silent
bash scripts/build.sh # esbuild → bundle.js

echo "Fetching metrics from $CODEMETRICS_URL …"
bash scripts/build-apps.sh

PORT="${PORT:-8000}"
echo "Dashboard built → http://localhost:$PORT  (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
