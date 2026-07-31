# Dodo iOS — Engineering

Public engineering page for the Dodo Pizza iOS app: beta (TestFlight), open source,
tech radar, roadmap, and a live view of the `dodobrands/dodo-mobile-ios` codebase's
modernization metrics.

**Live: https://dodobrands.github.io/mobile-code-metrics-dashboard/**

## What it is

A self-contained static site — one HTML page hydrated by a single bundled script:

- `index.html` / `style.css` — the page. Martian Mono display type (Google Fonts),
  Swift-orange accent, auto light/dark, one spacing scale (`--sp-*`).
- `app.js` — renders the metric charts with **Chart.js** (+ zoom plugin), imported as
  npm dependencies and bundled by esbuild into `bundle.js` (gitignored, built at deploy).
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

> **Deploy only what's drawn.** Every deployed chart file carries exactly the
> points a chart plots — metric, date, value — and nothing else. Reduce the
> service's richer shapes to the drawn value at build time: a `SWIFT_VERSION`
> per-target map → a version histogram; a `SwiftUI`/`UIKit` count → derived from
> the type counts; a deprecation message → its symbol. Never ship raw data a
> chart doesn't render.

## Deploy

`.github/workflows/deploy.yml` runs daily (and on demand). It installs tools via **mise**,
builds `bundle.js` (`npm ci` + esbuild), fetches + builds the data, and deploys to GitHub Pages.

Dormant until armed: set the repo variable `DEPLOY_ENABLED=true` and add the secrets
`MCM_URL` and `MCM_READ_TOKEN` (to fetch metrics) plus `MOBILE_CODE_METRICS_DASHBOARD`
(a token that can read the private `dodo-ai-platform/mobile-code-metrics` release, which
mise uses to install `mcm`).

## Local development

Validate the whole dashboard against **real metrics** with one command — it
fetches from the service, builds the data + bundle, and serves the site:

```
bash scripts/preview.sh          # → http://localhost:8000  (PORT overrides)
```

Credentials come from the environment, or 1Password (vault Mobile) as a
fallback: `MCM_URL` (defaults to the prod service) and `MCM_TOKEN` (a read
token; read from `op` if unset).

To build from a saved snapshot instead of the live service:

```
python3 data/build.py path/to/raw.json    # generate a local data snapshot
python3 data/build_roadmap.py             # inject the roadmap board into index.html
python3 -m http.server 8099               # serve the folder
open http://localhost:8099
```

## Dependencies

Nothing is vendored. Every dependency comes from one of three places:

- **mise** (`mise.toml`, pinned by `mise.lock`) — every CLI tool: Node, esbuild, Biome,
  html-validate, ruff, actionlint, Python, and `mcm` (the metrics fetcher). The full set
  installs in every environment — local, lint CI, deploy — with no per-environment scoping,
  because mise caches installs so reinstalling everything is cheap. Tools are always `latest`
  in `mise.toml`; `mise.lock` pins the exact versions. Bump with `mise up`.
- **npm** (`package.json`) — browser libraries (Chart.js + zoom plugin) and the typography
  tool (typopo). esbuild bundles them into `bundle.js`; `node_modules` is never shipped.
  Bump with `npm update`.
- **Google Fonts** — the Martian Mono webfont, via a `<link>` in `index.html`.

`mcm` is a private cross-org release, so mise needs a GitHub token that can read it (CI passes
the `MOBILE_CODE_METRICS_DASHBOARD` secret). Without the token mise errors on that one tool and
installs the rest — fine for any local work that doesn't fetch metrics.

## Tooling & contributing

- Install everything with `mise install`, and the libraries with `npm ci`. Once mise is
  installed, call any tool directly — `biome`, `esbuild`, `ruff`, `mcm` — with no `mise exec`
  prefix; mise puts them on `PATH`. Build the bundle: `bash scripts/build.sh`.
- Lint by running the linters directly (no `mise run` task): `biome check .`,
  `html-validate index.html`, `ruff check data`, `actionlint`, `node scripts/typography.mjs`.
  CI runs the same commands.
- Install the git hooks once: `./scripts/hooks/install.sh` — pre-commit auto-typographs
  authored text and runs the linters.
- `main` is protected: changes land via PR with a green `lint` check.
