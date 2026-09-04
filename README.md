# Dodo — Engineering dashboards

Public engineering pages for Dodo's mobile apps, one per app: a roadmap, product links, and a
live view of the codebase's modernization metrics from the `code-metrics` service.

**Live: https://dodobrands.github.io/code-metrics-dashboard/** — the root redirects to the first
app; every app lives at `…/<dir>/`, and that is the link to share.

| App | Repository | Page |
|---|---|---|
| Dodo Pizza iOS | `dodobrands/dodo-mobile-ios` | [`dodo-ios/`](https://dodobrands.github.io/code-metrics-dashboard/dodo-ios/) |
| Drinkit Android | `dodobrands/drinkit-mobile-android` | [`drinkit-android/`](https://dodobrands.github.io/code-metrics-dashboard/drinkit-android/) |

## How the site is put together

One static site, one shared bundle, a directory per app. Everything shared lives at the root,
everything an app owns lives in its directory, and every link between them is relative: this is
a project-path Pages site (`github.io/<repo>/`), so a root-absolute `href="/…"` would resolve
to `dodobrands.github.io/…` and 404.

**Shared**

- `apps.json` — the list of apps: directory, repository, names and blurbs, whether it has a
  roadmap. The switcher in the controls bar is built from it.
- `templates/app.html`, `templates/root.html` — the page template and the root redirect.
  `scripts/render-pages.mjs` stamps them into `<dir>/index.html` and `index.html` at build
  time; generated pages are gitignored and never committed.
- `app.js` (+ `lib/page.js`) — renders the charts with **Chart.js** (+ zoom plugin), bundled
  by esbuild into `bundle.js` (gitignored). It fetches `charts.json`, `page.json` and `data/`
  relative to the page, so it knows nothing about which app it is drawing.
- `style.css` — the shared look: Martian Mono display type (Google Fonts), Swift-orange
  accent, auto light/dark, one spacing scale (`--sp-*`).
- `og.json` — one share card per app (`output: "<dir>/og.png"`, `eyebrow` for the small line
  above the title) plus the root card, rendered by `scripts/og-image.sh` at deploy.
- `Tools/DashboardBuild` — the Swift build tools, `build` and `build-roadmap`. They resolve
  `charts.json`, `data/`, `roadmap/` and `index.html` against the working directory, which is
  why an app is a directory.

**Per app, in `<dir>/`**

| File | Required | What it is |
|---|---|---|
| `charts.json` | yes | the chart spec: id, group, title, note, kind, series — by **store names**, the metric names as the app's repository writes them. Shared by the page and the build. |
| `page.json` | no | `labels` (store name → legend label), `groupNotes` (a paragraph under a chart group's heading), `hero` (the headline as shares of one chart's last values: `{ chart, noun, parts: [{ series, text, class? }] }`). Without it: built-in labels, no notes, the Swift 6 headline when the data has one. |
| `sections.html` | no | product sections that belong to this app only, inserted under the charts. Its link text is the one place a non-Latin proper noun is allowed (a channel's own title) — see `scripts/latin-only.mjs`. |
| `mascot.html` | no | the footer easter egg's button — the app's own creature, carrying `id="mascot"`. Without it: the dodo. |
| `phrases.json` | no | the lines that creature says, replacing the shared `phrases.json` wholesale — an app whose mascot is not the dodo needs its own, because much of the shared list speaks as the bird. A non-empty array of non-empty strings, or the build fails. Without it: the shared list. |
| `roadmap/` | if `roadmap: true` | `index.json` (columns and their card ids) and one `<id>.json` per card: `title`, `description` (HTML), optional `progress` (0…1) — shown as a percentage on In Progress cards only. |
| `data/` | generated | `meta.json` and `charts/<id>.json`, written at build time from the service; gitignored. |

## Adding an app

1. Make sure the app's repository already writes to `code-metrics` under its `owner/name` — the
   dashboard reads with one shared token and needs no new secret.
2. Add an entry to `apps.json`: `dir`, `repo`, `name`, `eyebrow`, `heading`, `title`,
   `description`, `ogTitle`, `ogDescription`, `lede`, `roadmap`.
3. Create `<dir>/charts.json`. Keep the chart rules the existing specs follow: one unit per
   chart, series within an order of magnitude of each other, one "good" direction per chart,
   `share` only for a true partition. For a `bar` chart with `toggle` groups, add a `shorten`
   rule if the series keys are module paths (below).
4. Optionally add `page.json`, `sections.html`, `roadmap/`, `mascot.html` (+ `phrases.json`).
5. Add the app's card to `og.json`.
6. Run the checks (below). Nothing in `deploy.yml`, `app.js` or the templates changes: the
   deploy loop, the switcher and the lint glob all read `apps.json`.

The first deploy may find no data yet — a repository's backfill takes a few nightly runs.
The build then writes empty chart files and the page stands with its header, roadmap and
sections; charts appear as the series arrive.

## Data pipeline

Metrics come from the `code-metrics` service. Data is **never committed** — it is generated at
publish time and injected into the Pages artifact only.

```
bash scripts/build-apps.sh   # stamp pages, then per app: fetch → build → roadmap, inside <dir>/
```

Per app: `codemetrics get --repo <repo>` (or the HTTP API with `CODEMETRICS_URL` +
`CODEMETRICS_TOKEN` when the CLI isn't installed) into `<dir>/data/raw.json`, then
`swift run --package-path Tools/DashboardBuild build data/raw.json` with `<dir>` as the working
directory, and `build-roadmap` where `apps.json` says so.

- `<dir>/data/meta.json` — shared x-axis bounds, repo, updated date, year span, and the
  headline stats the build derives (the Swift 6 share, when `SWIFT_VERSION` is in the data).
- `<dir>/data/charts/<id>.json` — one file per chart, holding **only** that chart's series,
  under the store names; labels are the page's job.
- `bar` charts with `toggle` groups get two more rules at build time: only series alive at the
  group's newest commit are kept (a module renamed away would otherwise keep its bar forever),
  and a group's `shorten` rule — `{ dropSegments, dropSuffixes, collapseRepeats }` — turns a
  module path into the bar label (`contexts/common/payment/payment-impl` → `common/payment`),
  prefix kept; keys that shorten alike keep their full names.

> **Deploy only what's drawn.** Every deployed chart file carries exactly the points a chart
> plots — metric, date, value — and nothing else. Reduce the service's richer shapes to the
> drawn value at build time: a `SWIFT_VERSION` per-target map → a version histogram; a
> `SwiftUI`/`UIKit` count → derived from the type counts; a deprecation message → its symbol.
> Never ship raw data a chart doesn't render.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`, daily, and on demand. It installs
tools via **mise**, builds `bundle.js` (`npm ci` + esbuild), runs `scripts/build-apps.sh` for
every app in `apps.json`, renders the share cards, and deploys the whole tree to GitHub Pages.

It needs the secrets `CODEMETRICS_URL` and `CODEMETRICS_READ_TOKEN` (to fetch metrics — one
read token covers every repository) plus `CODE_METRICS_DASHBOARD` (a token that can read the
private `dodo-ai-platform/code-metrics` release, which mise uses to install `codemetrics`).

## Local development

Validate the whole site against **real metrics** with one command — it fetches every app from
the service, builds the data + bundle, and serves the site:

```
bash scripts/preview.sh          # → http://localhost:8000/<dir>/  (PORT overrides)
```

Credentials come from the environment, or 1Password (vault Mobile) as a fallback:
`CODEMETRICS_URL` and `CODEMETRICS_TOKEN` (a read token; read from `op` if unset). Everything
the build writes is gitignored, so a local build never leaves the checkout dirty.

To build one app from a saved snapshot instead of the live service:

```
node scripts/render-pages.mjs                                                 # stamp the pages
(cd <dir> && swift run --package-path ../Tools/DashboardBuild build path/to/raw.json)
(cd <dir> && swift run --package-path ../Tools/DashboardBuild build-roadmap)  # if it has one
python3 -m http.server 8099 && open http://localhost:8099/<dir>/
```

## Checks

CI (`.github/workflows/lint.yml`) runs, and so does the pre-commit hook:

| Check | What it guards |
|---|---|
| `biome check .` | JS/JSON/CSS lint |
| `node scripts/render-pages.mjs && html-validate index.html ./*/index.html` | every stamped page is valid HTML |
| `actionlint` | the workflows |
| `node scripts/typography.mjs` | authored text is typographed — templates, `apps.json`, `phrases.json`, and per app `charts.json`, `page.json`, `sections.html`, `mascot.html`, `phrases.json`, roadmap cards |
| `node scripts/latin-only.mjs` | every letter in the sources is Latin — this is a public English site. One exemption: the link text of an app's `sections.html`, where a channel's own title is a proper noun |
| `node scripts/latin-only.test.mjs` | the guard's one exemption: link text in an app's `sections.html`, and nothing else |
| `node scripts/typo.test.mjs` | the client-side typography |
| `node scripts/layout.test.mjs` | the layout on a two-app fixture and on the real `apps.json`: root redirect, switcher, relative links, og cards, per-app pages |
| `node scripts/page.test.mjs` | `page.json` and `phrases.json` handling: labels, notes, the hero, the mascot's lines, and nothing fetched without the file |
| `bash scripts/layout-dry-run.sh` | the whole per-app pipeline on the fixture with a stubbed fetch, in a scratch copy |
| `bash scripts/build-fixture-test.sh` | the data build on fixtures: live-series filter, `shorten`, roadmap progress, an app with no data yet, typography of `page.json` |

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

`codemetrics` is a private cross-org release, so mise needs a GitHub token that can read it (CI
passes the `CODE_METRICS_DASHBOARD` secret). Without the token mise errors on that one tool and
installs the rest — fine for any local work that doesn't fetch metrics.

## Tooling & contributing

- Install everything with `mise install`, and the libraries with `npm ci`. Once mise is
  installed, call any tool directly — `biome`, `esbuild`, `swift`, `codemetrics` — with no
  `mise exec` prefix; mise puts them on `PATH`. Build the bundle: `bash scripts/build.sh`.
- Install the git hooks once: `./scripts/hooks/install.sh` — pre-commit auto-typographs
  authored text and runs the checks above.
- `main` is protected: changes land via PR with a green `lint` check.
