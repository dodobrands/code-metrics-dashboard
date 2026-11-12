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

# --- migration: a disappearing framework must leave a zero, not a stale count --------
mkdir -p "$TMP/migration"
echo '[{ "id": "migration", "kind": "migration", "series": ["SwiftUI", "UIKit"], "moduleSeriesPrefix": "Migration:ByModule:" }]' >"$TMP/migration/charts.json"
python3 - "$TMP/migration/raw.json" <<'EOF'
import json, sys

def types(module, count=1):
    return [{"name": f"Type{i}", "path": f"Modules/{module}/Type{i}.swift"} for i in range(count)]

def metric(name, values):
    return {"name": name, "commits": [
        {"hash": str(i), "timestamp": f"2025-01-0{i + 1}T00:00:00Z", "value": value}
        for i, value in enumerate(values)
    ]}

metrics = [
    metric("View", [42, types("OrderHistory", 18) + types("Mixed") + types("UIKitOnly"),
                    types("OrderHistory", 18) + types("Mixed") + types("UIKitOnly"),
                    types("OrderHistory", 20) + types("Mixed")]),
    metric("UIView", [42, types("Mixed") + types("UIKitOnly") + types("Gone"), types("UIKitOnly"), []]),
    metric("UIViewController", [42, types("OrderHistory") + types("Mixed") + types("UIKitOnly"),
                                types("OrderHistory") + types("Mixed") + types("UIKitOnly"), types("UIKitOnly")]),
]
json.dump({"repo": "org/migration", "metrics": metrics}, open(sys.argv[1], "w"))
EOF
(cd "$TMP/migration" && swift run --package-path "$ROOT/Tools/DashboardBuild" build raw.json >/dev/null)
MIGRATION="$TMP/migration/data/charts/migration.json"
check "migration drops deleted modules" "! jq -e '.series[] | select(.name | contains(\":Gone:\"))' '$MIGRATION' >/dev/null"
check "migration records the last UIKit type disappearing" "jq -e '.series[] | select(.name == \"Migration:ByModule:OrderHistory:UIKit\") | .points == [[1735776000000,1],[1735862400000,1],[1735948800000,0]]' '$MIGRATION' >/dev/null"
check "migration keeps the current SwiftUI count" "jq -e '.series[] | select(.name == \"Migration:ByModule:OrderHistory:SwiftUI\") | .points[-1] == [1735948800000,20]' '$MIGRATION' >/dev/null"
check "migration sums UIKit kinds without losing zeroes" "jq -e '.series[] | select(.name == \"Migration:ByModule:Mixed:UIKit\") | .points == [[1735776000000,2],[1735862400000,1],[1735948800000,0]]' '$MIGRATION' >/dev/null"
check "migration records the last SwiftUI type disappearing" "jq -e '.series[] | select(.name == \"Migration:ByModule:UIKitOnly:SwiftUI\") | .points == [[1735776000000,1],[1735862400000,1],[1735948800000,0]]' '$MIGRATION' >/dev/null"
check "migration preserves the other UIKit kind when UIView empties" "jq -e '.series[] | select(.name == \"Migration:ByModule:UIKitOnly:UIKit\") | .points == [[1735776000000,2],[1735862400000,2],[1735948800000,1]]' '$MIGRATION' >/dev/null"
# A combined UIKit point requires both component measurements, not just one empty list.
for value in null 42; do
  jq --argjson value "$value" '(.metrics[] | select(.name == "UIViewController") | .commits[-1].value) = $value' "$TMP/migration/raw.json" >"$TMP/migration/incomplete-uikit.json"
  (cd "$TMP/migration" && swift run --package-path "$ROOT/Tools/DashboardBuild" build incomplete-uikit.json >/dev/null)
  check "migration skips incomplete UIKit snapshot ($value)" "jq -e '.series[] | select(.name == \"Migration:ByModule:OrderHistory:UIKit\") | .points == [[1735776000000,1],[1735862400000,1]]' '$MIGRATION' >/dev/null"
done
# An explicit empty list is a measured zero; a missing/legacy scalar sample is not.
jq '(.metrics[] | select(.name == "View") | .commits[-1].value) = []' "$TMP/migration/raw.json" >"$TMP/migration/empty-views.json"
(cd "$TMP/migration" && swift run --package-path "$ROOT/Tools/DashboardBuild" build empty-views.json >/dev/null)
check "migration records an entirely empty SwiftUI snapshot" "jq -e '.series[] | select(.name == \"Migration:ByModule:UIKitOnly:SwiftUI\") | .points == [[1735776000000,1],[1735862400000,1],[1735948800000,0]]' '$MIGRATION' >/dev/null"

# --- an app with none of the charted series yet -------------------------------------
mkdir -p "$TMP/empty"
echo '[{ "id": "line", "group": "T", "title": "Line", "kind": "line", "series": ["View"] }]' >"$TMP/empty/charts.json"
echo '{ "repo": "org/empty", "metrics": [ { "name": "kt", "commits": [ { "hash": "a", "timestamp": "2025-01-01T00:00:00Z", "value": 1 } ] } ] }' >"$TMP/empty/raw.json"
echo '<b id="updated">—</b>' >"$TMP/empty/index.html"
if (cd "$TMP/empty" && swift run --package-path "$ROOT/Tools/DashboardBuild" build raw.json >/dev/null 2>&1); then empty_exit=0; else empty_exit=$?; fi
check "AC-7 build with none of the charted series exits 0 (exit $empty_exit)" "[ $empty_exit -eq 0 ]"
check "AC-7 meta.json is written for the empty app" "[ -s '$TMP/empty/data/meta.json' ]"
check "AC-7 the chart file is an empty series list" "[ \"\$(cat '$TMP/empty/data/charts/line.json')\" = '{\"series\":[]}' ]"
check "AC-7 the updated date stays a dash" "grep -q '<b id=\"updated\">—</b>' '$TMP/empty/index.html'"

# --- roadmap: progress shows only on In Progress cards ------------------------------
mkdir -p "$TMP/rm/roadmap"
cat >"$TMP/rm/roadmap/index.json" <<'EOF'
{ "columns": [
  { "key": "backlog", "title": "Backlog", "items": ["later"] },
  { "key": "progress", "title": "In Progress", "items": ["half", "plain"] },
  { "key": "done", "title": "Done", "items": ["shipped"] } ] }
EOF
echo '{ "title": "Later", "description": "<p>Later.</p>", "progress": 0.4 }' >"$TMP/rm/roadmap/later.json"
echo '{ "title": "Half", "description": "<p>Half.</p>", "progress": 0.5 }' >"$TMP/rm/roadmap/half.json"
echo '{ "title": "Plain", "description": "<p>Plain.</p>" }' >"$TMP/rm/roadmap/plain.json"
echo '{ "title": "Shipped", "description": "<p>Shipped.</p>", "progress": 1 }' >"$TMP/rm/roadmap/shipped.json"
printf '<div id="board"><!--roadmap:board:start--><!--roadmap:board:end--></div>\n<!--roadmap:dialogs:start--><!--roadmap:dialogs:end-->\n' >"$TMP/rm/index.html"
(cd "$TMP/rm" && swift run --package-path "$ROOT/Tools/DashboardBuild" build-roadmap >/dev/null 2>&1)
RM=$(tr -d '\n' <"$TMP/rm/index.html")
check "AC-4 In Progress card with progress carries ten pips and the percent" "grep -q 'data-dialog=\"rm-half\">Half<span class=\"pips\"><span aria-hidden=\"true\">■■■■■<span class=\"pips-rest\">■■■■■</span></span><em>50%</em></span></button>' <<<'$RM'"
check "AC-4 In Progress card without progress is the plain markup" "grep -q '<li><button type=\"button\" class=\"card-item\" data-dialog=\"rm-plain\">Plain</button></li>' <<<'$RM'"
check "AC-4 Backlog and Done cards never show a percent" "grep -q 'data-dialog=\"rm-later\">Later</button>' <<<'$RM' && grep -q 'data-dialog=\"rm-shipped\">Shipped</button>' <<<'$RM'"
check "AC-4 the dialog of the In Progress card opens with the progress line" "grep -q '<div class=\"dlg-body\"><p>Progress: 50%</p><p>Half.</p></div>' <<<'$RM'"
check "AC-4 no other dialog mentions progress" "[ \$(grep -o 'Progress: ' <<<'$RM' | wc -l) -eq 1 ]"

# --- roadmap from Kaiten: kaiten.json makes roadmap/kaiten/ the only source ----------
ROADMAP_PAGE='<main><section id="roadmap"><h2>Roadmap</h2><div id="board"><!--roadmap:board:start--><!--roadmap:board:end--></div></section></main>\n<!--roadmap:dialogs:start--><!--roadmap:dialogs:end-->\n'
mkdir -p "$TMP/kt/roadmap/kaiten"
cp "$TMP/rm/roadmap/"*.json "$TMP/kt/roadmap/" # hand cards present, and must be ignored
echo '{ "filters": [] }' >"$TMP/kt/roadmap/kaiten.json"
echo '{ "columns": [ { "key": "progress", "title": "In Progress", "items": ["kaiten-1"] } ] }' >"$TMP/kt/roadmap/kaiten/index.json"
echo '{ "title": "From Kaiten", "description": "<p>K.</p>" }' >"$TMP/kt/roadmap/kaiten/kaiten-1.json"
printf "$ROADMAP_PAGE" >"$TMP/kt/index.html"
(cd "$TMP/kt" && swift run --package-path "$ROOT/Tools/DashboardBuild" build-roadmap >/dev/null 2>&1)
KT=$(tr -d '\n' <"$TMP/kt/index.html")
check "Kaiten: an app with kaiten.json shows the Kaiten cards" "grep -q 'data-dialog=\"rm-kaiten-1\">From Kaiten</button>' <<<'$KT'"
check "Kaiten: its hand-written cards are ignored" "! grep -q 'rm-half' <<<'$KT'"

mkdir -p "$TMP/kt-empty/roadmap"
echo '{ "filters": [] }' >"$TMP/kt-empty/roadmap/kaiten.json"
printf "$ROADMAP_PAGE" >"$TMP/kt-empty/index.html"
(cd "$TMP/kt-empty" && swift run --package-path "$ROOT/Tools/DashboardBuild" build-roadmap >/dev/null 2>&1)
check "Kaiten: a failed or empty pull hides the whole roadmap section" "! grep -q 'id=\"roadmap\"' '$TMP/kt-empty/index.html' && grep -q '<main></main>' '$TMP/kt-empty/index.html'"

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
# Baseline first: the fixture apps.json is canonicalised by --fix, so that the only
# thing left for the lint to find afterwards is the page.json.
(cd "$TMP/site" && node scripts/typography.mjs --fix >/dev/null 2>&1) || true
if (cd "$TMP/site" && node scripts/typography.mjs >/dev/null 2>&1); then baseline=0; else baseline=$?; fi
check "AC-8 baseline without page.json is clean (exit $baseline)" "[ $baseline -eq 0 ]"
cat >"$TMP/site/alpha/page.json" <<'EOF'
{ "groupNotes": { "UI": "It's about \"styling\"..." },
  "hero": { "chart": "c", "noun": "UI modules", "parts": [ { "series": "s", "text": "aren't shared" } ] } }
EOF
# Captured, not piped into grep -q: with pipefail an early-closed pipe would fail the check.
lint_out=$(cd "$TMP/site" && node scripts/typography.mjs 2>&1 || true)
if grep -q 'needs typography: alpha/page.json' <<<"$lint_out"; then before=1; else before=0; fi
(cd "$TMP/site" && node scripts/typography.mjs --fix >/dev/null 2>&1) || true
if (cd "$TMP/site" && node scripts/typography.mjs >/dev/null 2>&1); then after=0; else after=$?; fi
check "AC-8 an untypographed page.json is what the typography lint names" "[ $before -eq 1 ]"
check "AC-8 after --fix the lint passes (exit $after)" "[ $after -eq 0 ]"
check "AC-8 --fix curled the quotes in page.json" "grep -q '“styling”' '$TMP/site/alpha/page.json' && grep -q 'aren’t' '$TMP/site/alpha/page.json'"

[ "$fail" = 0 ] && echo "build fixture test: all checks passed" || { echo "build fixture test: FAILED"; exit 1; }
