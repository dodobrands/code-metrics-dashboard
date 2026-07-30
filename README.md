# Dodo iOS — Engineering

Public engineering page for the Dodo Pizza iOS app: beta (TestFlight), open source,
tech radar, roadmap, and a live view of the `dodobrands/dodo-mobile-ios` codebase's
modernization metrics.

**Live: https://dodobrands.github.io/mobile-code-metrics-dashboard/**

## What it is

A self-contained static site (no framework, no build step for the page itself):

- `index.html` / `style.css` — the page. Martian Mono display type, Swift-orange accent,
  auto light/dark, one spacing scale (`--sp-*`).
- `app.js` — renders the metric charts with a vendored **Chart.js** (+ zoom plugin).
- `vendor/` — Chart.js, the zoom plugin and the font, all vendored (no CDN, strict-CSP safe).
- `charts.json` — the chart spec (id, title, kind, series). Single source of truth shared
  by the page **and** the build.

## Data pipeline

Metrics come from the `mobile-code-metrics` service via its `mcm` CLI. Data is **never
committed** — it is generated at publish time and injected into the Pages artifact only.

```
mcm get --repo dodobrands/dodo-mobile-ios      # full JSON dump  → data/raw.json
python data/build.py data/raw.json             # → data/meta.json + data/charts/<id>.json
```

- `data/meta.json` — shared x-axis bounds, repo/updated, and the headline stats
  (Swift 6 %, SwiftUI share, year span) — all computed, never hardcoded.
- `data/charts/<id>.json` — one file per chart, holding **only** that chart's series.

## Deploy

`.github/workflows/deploy.yml` runs daily (and on demand). It installs `mcm` via **mise**,
fetches + builds the data, and deploys to GitHub Pages.

Dormant until armed: set the repo variable `DEPLOY_ENABLED=true` and add the secrets
`MCM_URL`, `MCM_READ_TOKEN` and `MCM_INSTALL_TOKEN` (a token that can read the private
`dodo-ai-platform/mobile-code-metrics` release).

## Local development

```
python3 data/build.py path/to/raw.json    # generate a local data snapshot
python3 -m http.server 8099               # serve the folder
open http://localhost:8099
```

## Tooling & contributing

- Everything installs through **mise** (`mise.toml`, pinned by `mise.lock`).
- Lint everything with `mise run lint` — Biome (JS/CSS), html-validate (HTML),
  ruff (Python), actionlint (workflows).
- Install the git hooks once: `./scripts/hooks/install.sh` (pre-commit runs the linters).
- `main` is protected: changes land via PR with a green `lint` check.
