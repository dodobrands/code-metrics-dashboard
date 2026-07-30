#!/bin/bash

# pre-commit: run the full lint suite (biome / html-validate / ruff / actionlint).
# The repo is tiny, so linting everything is instant — no staged-file filtering.
set -uo pipefail

# mise on PATH — hooks run outside the login shell.
export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
exec mise run lint
