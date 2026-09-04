# Dodo — Engineering dashboards

Public engineering pages for Dodo's mobile apps, one per app: product links (beta, open
source, tech radar), a roadmap, and a live view of the codebase's modernization metrics
from the `code-metrics` service. Today: the Dodo Pizza iOS app (`dodobrands/dodo-mobile-ios`)
and the Drinkit Android app (`dodobrands/drinkit-mobile-android`).

**Live: https://dodobrands.github.io/code-metrics-dashboard/** (redirects to the first app,
`dodo-ios/`; each app is a directory, so `…/<dir>/` is the link to share).

## What it is

A self-contained static site — one page per app, hydrated by a single shared bundle:

- `apps.json` — the list of apps: directory, repository, names and blurbs, whether it has a
  roadmap. **Adding an app is one entry here** plus its directory (below).
- `templates/app.html` / `templates/root.html` — the page template and the root redirect.
  `scripts/render-pages.mjs` stamps them into `<dir>/index.html` and `index.html` at build
  time; the generated pages are gitignored.
- `style.css` — shared look. Martian Mono display type (Google Fonts), Swift-orange
  accent, auto light/dark, one spacing scale (`--sp-*`).
- `app.js` — renders the metric charts with **Chart.js** (+ zoom plugin), imported as
  npm dependencies and bundled by esbuild into `bundle.js` (gitignored, built at deploy).
  It fetches `charts.json` and `data/` relative to the page, so every app directory gets
  its own without any code change.
- `<dir>/charts.json` — the app's chart spec (id, title, kind, series). Single source of
  truth shared by the page **and** the build.
- `<dir>/sections.html` — optional; product sections that belong to that app only.
- `<dir>/page.json` — optional; `labels` (store name → legend label), `groupNotes` (a paragraph
  under a chart group's heading), `hero` (the headline as shares of one chart's last values:
  `{ chart, noun, parts: [{ series, text, class? }] }`). Without it the page uses the built-in
  labels and the Swift 6 headline.
- `<dir>/roadmap/` — the roadmap cards, when `apps.json` says the app has one. A card's optional
  `progress` (0…1) shows as a percentage on In Progress cards only.

The site is a project-path Pages site (`github.io/<repo>/`), so every link is relative —
apps link to each other as `../<dir>/`, pages load `../bundle.js` and `../style.css`. A
root-absolute `href="/…"` would resolve to `dodobrands.github.io/…` and 404.

## Data pipeline

Metrics come from the `code-metrics` service via its `codemetrics` CLI. Data is **never
committed** — it is generated at publish time and injected into the Pages artifact only.

```
bash scripts/build-apps.sh   # stamp pages, then per app: fetch → build → roadmap, inside <dir>/
```

Per app, that is `codemetrics get --repo <repo>` (or the HTTP API with `CODEMETRICS_URL` +
`CODEMETRICS_TOKEN` when the CLI isn't installed) into `<dir>/data/raw.json`, then
`swift run --package-path Tools/DashboardBuild build data/raw.json` with `<dir>` as the
working directory — the build tools resolve `charts.json`, `data/`, `roadmap/` and
`index.html` against it — and `build-roadmap` where `apps.json` says so.

- `<dir>/data/meta.json` — shared x-axis bounds, repo/updated, and the headline stats
  (Swift 6 %, SwiftUI share, year span) — all computed, never hardcoded.
- `<dir>/data/charts/<id>.json` — one file per chart, holding **only** that chart's series.
  For a `bar` chart with `toggle` groups, only series alive at the group's newest commit are
  kept (a module renamed away would otherwise keep its bar forever), and a group's `shorten`
  rule — `{ dropSegments, dropSuffixes, collapseRepeats }` — turns a module path into the bar
  label, prefix kept; keys that shorten alike keep their full names.

> **Deploy only what's drawn.** Every deployed chart file carries exactly the
> points a chart plots — metric, date, value — and nothing else. Reduce the
> service's richer shapes to the drawn value at build time: a `SWIFT_VERSION`
> per-target map → a version histogram; a `SwiftUI`/`UIKit` count → derived from
> the type counts; a deprecation message → its symbol. Never ship raw data a
> chart doesn't render.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`, daily, and on demand. It installs
tools via **mise**, builds `bundle.js` (`npm ci` + esbuild), fetches + builds the data, and
deploys to GitHub Pages.

It needs the secrets `CODEMETRICS_URL` and `CODEMETRICS_READ_TOKEN` (to fetch metrics) plus
`CODE_METRICS_DASHBOARD` (a token that can read the private
`dodo-ai-platform/code-metrics` release, which mise uses to install `codemetrics`).

## Local development

Validate the whole dashboard against **real metrics** with one command — it
fetches from the service, builds the data + bundle, and serves the site:

```
bash scripts/preview.sh          # → http://localhost:8000  (PORT overrides)
```

Credentials come from the environment, or 1Password (vault Mobile) as a
fallback: `CODEMETRICS_URL` (defaults to the prod service) and `CODEMETRICS_TOKEN` (a read
token; read from `op` if unset).

To build from a saved snapshot instead of the live service:

```
node scripts/render-pages.mjs                                                   # stamp the pages
(cd dodo-ios && swift run --package-path ../Tools/DashboardBuild build path/to/raw.json)  # data snapshot
(cd dodo-ios && swift run --package-path ../Tools/DashboardBuild build-roadmap)           # roadmap board
python3 -m http.server 8099                                                     # serve the folder
open http://localhost:8099/dodo-ios/
```

The layout itself is covered by `node scripts/layout.test.mjs` (a two-app fixture:
redirect, switcher, relative links, og cards) and `bash scripts/layout-dry-run.sh` (the
whole pipeline on that fixture with a stubbed fetch, in a scratch copy of the checkout).

## Dependencies

Nothing is vendored. Every dependency comes from one of three places:

- **mise** (`mise.toml`, pinned by `mise.lock`) — every CLI tool: Node, Swift, esbuild, Biome,
  html-validate, actionlint, Python, and `codemetrics` (the metrics fetcher). The full set
  installs in every environment — local, lint CI, deploy — with no per-environment scoping,
  because mise caches installs so reinstalling everything is cheap. Tools are always `latest`
  in `mise.toml`; `mise.lock` pins the exact versions. Bump with `mise up`.
- **npm** (`package.json`) — browser libraries (Chart.js + zoom plugin) and the typography
  tool (typopo). esbuild bundles them into `bundle.js`; `node_modules` is never shipped.
  Bump with `npm update`.
- **Google Fonts** — the Martian Mono webfont, via a `<link>` in `templates/app.html`.

`codemetrics` is a private cross-org release, so mise needs a GitHub token that can read it (CI passes
the `CODE_METRICS_DASHBOARD` secret). Without the token mise errors on that one tool and
installs the rest — fine for any local work that doesn't fetch metrics.

## Tooling & contributing

- Install everything with `mise install`, and the libraries with `npm ci`. Once mise is
  installed, call any tool directly — `biome`, `esbuild`, `swift`, `codemetrics` — with no `mise exec`
  prefix; mise puts them on `PATH`. Build the bundle: `bash scripts/build.sh`.
- Lint by running the linters directly (no `mise run` task): `biome check .`,
  `node scripts/render-pages.mjs && html-validate index.html ./*/index.html`, `actionlint`,
  `node scripts/typography.mjs`, `node scripts/layout.test.mjs`, `node scripts/page.test.mjs`,
  `bash scripts/build-fixture-test.sh`,
  `node scripts/latin-only.mjs` (every letter in the sources must be Latin — this is a public English page).
  CI runs the same commands.
- Install the git hooks once: `./scripts/hooks/install.sh` — pre-commit auto-typographs
  authored text and runs the linters.
- `main` is protected: changes land via PR with a green `lint` check.
