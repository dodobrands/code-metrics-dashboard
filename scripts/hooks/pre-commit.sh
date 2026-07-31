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
    git add roadmap index.html
else
    echo "pre-commit: node_modules/typopo missing — run 'npm ci' to enable auto-typography" >&2
fi

biome check . && html-validate index.html && actionlint && node scripts/typography.mjs
