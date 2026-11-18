#!/bin/bash
# Read committed OKR snapshots at a single revision. Only the aggregates reach Pages.
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
if [[ -n "${MOBILE_OKRS_READ_TOKEN:-}" ]]; then
  export GH_TOKEN="$MOBILE_OKRS_READ_TOKEN"
fi
gh api repos/dodobrands/mobile_okrs/tarball/main | python3 "$dir/android-okr-metrics.py" "$1"
