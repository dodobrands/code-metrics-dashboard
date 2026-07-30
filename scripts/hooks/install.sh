#!/bin/bash

# Point git at the version-controlled hooks. Run once after cloning.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
git -C "$ROOT" config core.hooksPath .githooks
echo "Installed git hooks (core.hooksPath=.githooks)"
