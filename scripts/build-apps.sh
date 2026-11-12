#!/bin/bash

# Build every app in apps.json: stamp the pages, then fetch and build each app's data
# inside its own directory. The Swift build tools resolve charts.json, data/,
# roadmap/ and index.html against the working directory, so per-app output is a
# `cd` — no per-app flags. Pages are stamped first because the tools write into an
# existing index.html (the updated date, the roadmap board).
#
# Fetching: `codemetrics get` when the CLI is installed (deploy, via mise); otherwise
# the service's HTTP API with CODEMETRICS_URL + CODEMETRICS_TOKEN — the same JSON.
# CODEMETRICS_FETCH=<command> replaces both with `<command> <repo>` on stdout, which
# is how the dry run feeds a fixture.
#
# Usage: bash scripts/build-apps.sh            APPS_JSON overrides apps.json (dry run)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD
APPS="${APPS_JSON:-apps.json}"
TOOLS="$ROOT/Tools/DashboardBuild"

node scripts/render-pages.mjs --apps "$APPS" --out "$ROOT"

fetch_raw() { # repo → JSON on stdout
  if [ -n "${CODEMETRICS_FETCH:-}" ]; then
    "$CODEMETRICS_FETCH" "$1"
  elif command -v codemetrics >/dev/null; then
    codemetrics get --repo "$1"
  else
    : "${CODEMETRICS_URL:?CODEMETRICS_URL is required without the codemetrics CLI}"
    : "${CODEMETRICS_TOKEN:?CODEMETRICS_TOKEN is required without the codemetrics CLI}"
    # The service 502s intermittently — retry on any transient error.
    curl -fsS --retry 5 --retry-all-errors --retry-delay 3 \
      -H "Authorization: Bearer $CODEMETRICS_TOKEN" \
      "$CODEMETRICS_URL/metrics?repo=$1"
  fi
}

jq -c '.[]' "$APPS" | while read -r app; do
  dir=$(jq -r .dir <<<"$app")
  repo=$(jq -r .repo <<<"$app")
  roadmap=$(jq -r .roadmap <<<"$app")
  echo "== $dir ($repo)"
  mkdir -p "$dir/data"
  fetch_raw "$repo" >"$dir/data/raw.json"
  (cd "$dir" && swift run --package-path "$TOOLS" build data/raw.json)
  # An app with roadmap/kaiten.json takes its roadmap from Kaiten. It runs after the
  # data build: a card's progress can come from the chart data just written.
  if [ "$roadmap" = true ] && [ -f "$dir/roadmap/kaiten.json" ]; then
    node scripts/kaiten-roadmap.mjs "$dir"
  fi
  (
    cd "$dir"
    if [ "$roadmap" = true ]; then
      swift run --package-path "$TOOLS" build-roadmap
    fi
    rm -f data/raw.json
  )
done
