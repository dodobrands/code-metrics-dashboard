#!/bin/bash
# Append a second numeric metrics feed before the Swift build. The input remains intact on error.
set -euo pipefail
raw=$1
source_file_or_url=$2
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
case "$source_file_or_url" in
  https://*) curl -fsSL --retry 3 --max-time 60 "$source_file_or_url" -o "$tmp/feed.json" ;;
  *) cp "$source_file_or_url" "$tmp/feed.json" ;;
esac
jq --slurpfile feed "$tmp/feed.json" '
  ($feed[0].metrics) as $extra |
  if ($extra | type == "array" and length > 0 and all(.[];
    (.name | type == "string") and (.commits | type == "array" and length > 0 and
      all(.[]; (.timestamp | type == "string") and (.value | type == "number")))))
  then .metrics += $extra else error("Missing or invalid numeric metrics feed") end |
  if ([.metrics[].name] | group_by(.) | any(length > 1))
  then error("Duplicate metric names across sources") else . end
' "$raw" >"$tmp/merged.json"
mv "$tmp/merged.json" "$raw"
