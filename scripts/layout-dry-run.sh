#!/bin/bash

# The whole per-app pipeline on a two-app fixture with a stubbed fetch, in a scratch
# copy of the checkout — so it proves what a deploy would do without touching the
# service or leaving files behind:
#   - each app's data lands in its own directory (meta.json, charts/*.json);
#   - the roadmap board is filled only where apps.json declares one;
#   - every relative href/src in every generated page resolves to a file.
#
# Usage: bash scripts/layout-dry-run.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SITE="$TMP/site"
mkdir -p "$SITE"
# SwiftPM's module cache is bound to its absolute path, so the copy builds the tools afresh.
rsync -a --exclude .git --exclude node_modules --exclude .build . "$SITE/"

# Fixture: alpha has a roadmap and its own sections, beta has neither.
cat >"$SITE/apps.json" <<'EOF'
[
  { "dir": "alpha", "repo": "org/alpha-app", "name": "Alpha", "eyebrow": "Org · Alpha", "heading": "Alpha Engineering",
    "title": "Alpha—Engineering", "description": "Alpha.", "ogTitle": "Alpha — Org", "ogDescription": "Alpha.",
    "lede": "A live look at the", "roadmap": true },
  { "dir": "beta", "repo": "org/beta-app", "name": "Beta", "eyebrow": "Org · Beta", "heading": "Beta Engineering",
    "title": "Beta—Engineering", "description": "Beta.", "ogTitle": "Beta — Org", "ogDescription": "Beta.",
    "lede": "A live look at the", "roadmap": false }
]
EOF
for app in alpha beta; do
  mkdir -p "$SITE/$app"
  cat >"$SITE/$app/charts.json" <<'EOF'
[
  { "id": "ui-components", "group": "UI", "title": "Components", "kind": "line", "series": ["View", "UIView"] }
]
EOF
done
cp -R "$SITE/dodo-ios/roadmap" "$SITE/alpha/roadmap"
echo '<section id="more"><h2>Alpha extras</h2></section>' >"$SITE/alpha/sections.html"
rm -rf "$SITE/dodo-ios"

# The stub stands in for `codemetrics get <repo>`: the same JSON shape, two points per metric.
cat >"$TMP/fetch" <<'EOF'
#!/bin/bash
cat <<JSON
{ "repo": "$1", "metrics": [
  { "name": "View", "commits": [
    { "hash": "a", "timestamp": "2025-01-01T00:00:00Z", "value": 10 },
    { "hash": "b", "timestamp": "2025-06-01T00:00:00Z", "value": 25 } ] },
  { "name": "UIView", "commits": [
    { "hash": "a", "timestamp": "2025-01-01T00:00:00Z", "value": 40 },
    { "hash": "b", "timestamp": "2025-06-01T00:00:00Z", "value": 30 } ] } ] }
JSON
EOF
chmod +x "$TMP/fetch"

(cd "$SITE" && CODEMETRICS_FETCH="$TMP/fetch" bash scripts/build-apps.sh)
: >"$SITE/bundle.js" # esbuild output, not part of this run; pages link to it

fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

for app in alpha beta; do
  check "$app: data/meta.json written in the app directory" "[ -s '$SITE/$app/data/meta.json' ]"
  check "$app: data/charts/ui-components.json written" "[ -s '$SITE/$app/data/charts/ui-components.json' ]"
  check "$app: meta.repo is the app's repository" "grep -q '\"repo\":\"org/$app-app\"' '$SITE/$app/data/meta.json'"
  check "$app: updated date inlined into the page" "grep -q '<b id=\"updated\">2025-06-01</b>' '$SITE/$app/index.html'"
  check "$app: raw.json removed" "[ ! -e '$SITE/$app/data/raw.json' ]"
done
check "alpha: roadmap board filled between the markers" "tr -d '\\n' <'$SITE/alpha/index.html' | grep -q 'roadmap:board:start-->[[:space:]]*<div class=\"col\"'"
check "beta: no roadmap markers at all" "! grep -q 'roadmap:board' '$SITE/beta/index.html'"
check "root: index.html redirects to alpha" "grep -q 'url=alpha/' '$SITE/index.html'"

# Every relative href/src of every generated page must exist on disk.
for page in "$SITE/index.html" "$SITE/alpha/index.html" "$SITE/beta/index.html"; do
  dir=$(dirname "$page")
  while read -r ref; do
    case "$ref" in http://*|https://*|'#'*|data:*) continue ;; esac
    target="$dir/${ref%%[#?]*}"
    [ "${ref%/}" != "$ref" ] && target="$target/index.html"
    check "$(basename "$dir")/index.html → $ref" "[ -e '$target' ]"
  done < <(grep -o '\(href\|src\)="[^"]*"' "$page" | sed 's/^[a-z]*="//; s/"$//')
done

[ "$fail" = 0 ] && echo "layout dry run: all checks passed" || { echo "layout dry run: FAILED"; exit 1; }
