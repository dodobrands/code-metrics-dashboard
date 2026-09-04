#!/bin/bash

# pre-commit: auto-typograph authored texts, then run the full lint suite.
# The repo is tiny, so linting everything is instant — no staged-file filtering.
set -uo pipefail

# mise + node on PATH — hooks run outside the login shell.
export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Apply typography (typopo) and re-stage anything it changed, so committed text
# is always typographed. Needs `npm ci` once to install typopo.
if [ -d node_modules/typopo ]; then
    node scripts/typography.mjs --fix
    git add apps.json templates phrases.json
    for d in $(jq -r '.[].dir' apps.json); do git add "$d/charts.json" "$d/roadmap" "$d/sections.html" "$d/page.json" 2>/dev/null; done
else
    echo "pre-commit: node_modules/typopo missing — run 'npm ci' to enable auto-typography" >&2
fi

biome check . && node scripts/render-pages.mjs >/dev/null && html-validate index.html ./*/index.html && actionlint && node scripts/typography.mjs && node scripts/latin-only.mjs && node scripts/typo.test.mjs && node scripts/layout.test.mjs && node scripts/page.test.mjs
