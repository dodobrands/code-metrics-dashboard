#!/bin/bash

# Generate 1200×630 Open Graph share cards (dark graphite + Swift-orange, mono).
# Card text lives in og.json; the image is a build output (gitignored), rendered
# here locally and at deploy. Needs ImageMagick (`magick` or `convert`).
#
# Usage:
#   scripts/og-image.sh                              # render every card in og.json
#   scripts/og-image.sh "Title" "Subtitle" out.png   # render one card ad hoc
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

IM="$(command -v magick || command -v convert || true)"
[ -n "$IM" ] || { echo "ImageMagick (magick/convert) is required" >&2; exit 1; }

# First monospace font that exists (macOS, then Linux CI).
FONT=""
for f in \
  "/System/Library/Fonts/Menlo.ttc" \
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf" \
  "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"; do
  [ -f "$f" ] && FONT="$f" && break
done
[ -n "$FONT" ] || { echo "no monospace font found" >&2; exit 1; }

EYEBROW="DODO PIZZA · iOS"

render() { # title subtitle output [eyebrow]
  local eyebrow="${4:-$EYEBROW}"
  mkdir -p "$(dirname "$3")"
  "$IM" -size 1200x630 xc:'#0e1216' \
    -fill '#eb6834' -draw "roundrectangle 90,196 100,434 5,5" \
    -font "$FONT" \
    -fill '#eb8a5f' -pointsize 30 -kerning 6 -annotate +128+224 "$eyebrow" \
    -kerning 0 -fill '#f4f2ee' -pointsize 96 -annotate +122+322 "$1" \
    -fill '#9aa2ab' -pointsize 31 -annotate +128+402 "$2" \
    "$3"
  echo "wrote $3"
}

if [ "$#" -ge 2 ]; then
  render "$1" "$2" "${3:-og.png}"
else
  while IFS=$'\t' read -r title subtitle output eyebrow; do
    render "$title" "$subtitle" "$output" "$eyebrow"
  done < <(python3 -c "import json; [print(c['title']+chr(9)+c['subtitle']+chr(9)+c['output']+chr(9)+c.get('eyebrow', '')) for c in json.load(open('og.json'))['cards']]")
fi
