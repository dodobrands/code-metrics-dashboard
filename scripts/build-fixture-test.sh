#!/bin/bash

# The data build on a fixture, in a scratch directory:
#   - a toggle group keeps only series alive at its newest commit;
#   - a group with a `shorten` rule labels bars by the shortened key, prefix kept,
#     and two keys that shorten alike keep their full names;
#   - a group without the rule, and a line chart, keep names verbatim.
# Plus the typography lint on a fixture page.json, in a scratch copy of the checkout.
#
# Usage: bash scripts/build-fixture-test.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

# --- data build -----------------------------------------------------------------
mkdir -p "$TMP/build"
cat >"$TMP/build/charts.json" <<'EOF'
[
  { "id": "fam", "group": "T", "title": "Families", "kind": "bar", "toggle": [
    { "label": "A", "seriesPrefix": "Family:", "topN": 30,
      "shorten": { "dropSegments": ["contexts", "features", "impl"], "dropSuffixes": ["-impl"], "collapseRepeats": true } },
    { "label": "B", "seriesPrefix": "Other:", "topN": 30 } ] },
  { "id": "line", "group": "T", "title": "Line", "kind": "line", "series": ["View"] }
]
EOF
python3 - "$TMP/build/raw.json" <<'EOF'
import json, sys
t1, t2 = "2025-01-01T00:00:00Z", "2025-06-01T00:00:00Z"
two = lambda: [{"hash": "a", "timestamp": t1, "value": 3}, {"hash": "b", "timestamp": t2, "value": 5}]
one = lambda: [{"hash": "a", "timestamp": t1, "value": 9}]
metrics = [
  {"name": "Family:contexts/common/payment/payment-impl", "commits": two()},
  {"name": "Family:contexts/product/features/view", "commits": two()},
  {"name": "Family:infra/toggles/impl", "commits": two()},
  {"name": "Family:dead", "commits": one()},
  {"name": "Family:contexts/x/features/view", "commits": two()},
  {"name": "Family:x/view", "commits": two()},
  {"name": "Other:a/b-impl", "commits": two()},
  {"name": "Other:old", "commits": one()},
  {"name": "View", "commits": two()},
]
json.dump({"repo": "org/fixture", "metrics": metrics}, open(sys.argv[1], "w"))
EOF
(cd "$TMP/build" && swift run --package-path "$ROOT/Tools/DashboardBuild" build raw.json >/dev/null)
names() { jq -r '.series[].name' "$TMP/build/data/charts/$1.json" | sort | tr '\n' ' '; }
FAM=$(names fam)
echo "fam series: $FAM"
check "AC-5 dead series (last point before the group's newest) is dropped" "! grep -q 'Family:dead' <<<'$FAM'"
check "AC-5 the other group's dead series is dropped too" "! grep -q 'Other:old' <<<'$FAM'"
check "AC-5 a live series of the other group stays" "grep -q 'Other:a/b-impl' <<<'$FAM'"
check "AC-6 contexts/common/payment/payment-impl → common/payment" "grep -q 'Family:common/payment ' <<<'$FAM'"
check "AC-6 contexts/product/features/view → product/view" "grep -q 'Family:product/view ' <<<'$FAM'"
check "AC-6 infra/toggles/impl → infra/toggles" "grep -q 'Family:infra/toggles ' <<<'$FAM'"
check "AC-6 two keys that shorten alike keep their full names" "grep -q 'Family:contexts/x/features/view ' <<<'$FAM' && grep -q 'Family:x/view ' <<<'$FAM'"
check "AC-7 a group without shorten keeps names verbatim" "grep -q 'Other:a/b-impl ' <<<'$FAM'"
check "AC-7 a line chart keeps names verbatim" "[ \"\$(names line)\" = 'View ' ]"
check "series count: 3 shortened + 2 collided + 1 other" "[ \$(jq '.series | length' '$TMP/build/data/charts/fam.json') -eq 6 ]"

# --- typography on a fixture page.json --------------------------------------------
mkdir -p "$TMP/site"
rsync -a --exclude .git --exclude node_modules --exclude .build "$ROOT/" "$TMP/site/"
ln -s "$ROOT/node_modules" "$TMP/site/node_modules"
mkdir -p "$TMP/site/alpha"
echo '[]' >"$TMP/site/alpha/charts.json"
cat >"$TMP/site/apps.json" <<'EOF'
[ { "dir": "alpha", "repo": "org/alpha", "name": "Alpha", "eyebrow": "Org · Alpha", "heading": "Alpha", "title": "Alpha",
    "description": "Alpha.", "ogTitle": "Alpha", "ogDescription": "Alpha.", "lede": "A look at the", "roadmap": false } ]
EOF
cat >"$TMP/site/alpha/page.json" <<'EOF'
{ "groupNotes": { "UI": "It's about \"styling\"..." },
  "hero": { "chart": "c", "noun": "UI modules", "parts": [ { "series": "s", "text": "aren't shared" } ] } }
EOF
if (cd "$TMP/site" && node scripts/typography.mjs >/dev/null 2>&1); then before=0; else before=$?; fi
(cd "$TMP/site" && node scripts/typography.mjs --fix >/dev/null 2>&1) || true
if (cd "$TMP/site" && node scripts/typography.mjs >/dev/null 2>&1); then after=0; else after=$?; fi
check "AC-8 an untypographed page.json fails the typography lint (exit $before)" "[ $before -ne 0 ]"
check "AC-8 after --fix the lint passes (exit $after)" "[ $after -eq 0 ]"
check "AC-8 --fix curled the quotes in page.json" "grep -q '“styling”' '$TMP/site/alpha/page.json' && grep -q 'aren’t' '$TMP/site/alpha/page.json'"

[ "$fail" = 0 ] && echo "build fixture test: all checks passed" || { echo "build fixture test: FAILED"; exit 1; }
