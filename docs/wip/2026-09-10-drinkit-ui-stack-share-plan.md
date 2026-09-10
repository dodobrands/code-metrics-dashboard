# Drinkit UI Stack Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dsp-subagent-driven-development (recommended) or
> dsp-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Render Drinkit Android UI module stacks as three normalized shares and remove the typography and color share cards.

**Architecture:** Move timestamp alignment and percentage normalization into a pure `shareSeries` helper in `lib/page.js`, then let the Chart.js renderer map every normalized series to one stacked area. Keep chart selection declarative in `drinkit-android/charts.json`.

**Tech Stack:** JavaScript ES modules, Node test runner, Chart.js, JSON chart specifications.

## Global Constraints

- A `share` chart accepts every series listed in spec order.
- Percentages total 100 at every timestamp common to all listed series.
- Existing two-series share output remains unchanged, including the zero-total fallback.
- No changes to metric collection, storage, or the Dodo iOS chart specification.

---

## File Structure

- Modify `lib/page.js`: own pure alignment and normalization for share charts.
- Modify `scripts/page.test.mjs`: cover three-series normalization and two-series compatibility.
- Modify `app.js`: render one stacked dataset for every normalized share series.
- Modify `drinkit-android/charts.json`: switch module stacks to `share` and remove two obsolete cards.
- Create `scripts/charts.test.mjs`: lock the Drinkit chart inventory and module-stack specification.
- Modify `package.json`: include the chart-spec test in the standard test command.

### Task 1: Normalize any number of share series

**Files:**
- Modify: `lib/page.js`
- Modify: `scripts/page.test.mjs`

**Interfaces:**
- Consumes: an ordered array of `{ name, points }` metric series, where each point is `[timestamp, value]`.
- Produces: `shareSeries(series)`, returning ordered `{ name, points }` entries with Chart.js `{ x, y }` percentage points.

- [ ] **Step 1: Write failing normalization and compatibility tests**

Add `shareSeries` to the import from `../lib/page.js`, then add:

```js
test("shareSeries normalizes three series at their common timestamps", () => {
  const result = shareSeries([
    { name: "Compose-only", points: [[1, 20], [2, 30]] },
    { name: "Mixed", points: [[1, 50], [2, 50]] },
    { name: "View-only", points: [[1, 30], [2, 20]] },
  ]);

  assert.deepEqual(result, [
    { name: "Compose-only", points: [{ x: 1, y: 20 }, { x: 2, y: 30 }] },
    { name: "Mixed", points: [{ x: 1, y: 50 }, { x: 2, y: 50 }] },
    { name: "View-only", points: [{ x: 1, y: 30 }, { x: 2, y: 20 }] },
  ]);
});

test("shareSeries keeps the two-series zero-total fallback", () => {
  assert.deepEqual(shareSeries([
    { name: "Theme", points: [[1, 1], [2, 0], [3, 3]] },
    { name: "Literal", points: [[1, 3], [2, 0]] },
  ]), [
    { name: "Theme", points: [{ x: 1, y: 25 }, { x: 2, y: 0 }] },
    { name: "Literal", points: [{ x: 1, y: 75 }, { x: 2, y: 100 }] },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/page.test.mjs`

Expected: **FAIL** because `lib/page.js` does not export `shareSeries`.

- [ ] **Step 3: Implement the pure helper**

Add to `lib/page.js`:

```js
export function shareSeries(series) {
  if (!series.length) return [];
  const values = series.map(({ points }) => new Map(points));
  const timestamps = [...values[0].keys()]
    .filter((timestamp) => values.every((metric) => metric.has(timestamp)))
    .sort((a, b) => a - b);

  return series.map(({ name }, index) => ({
    name,
    points: timestamps.map((x) => {
      const total = values.reduce((sum, metric) => sum + metric.get(x), 0);
      const y = total > 0
        ? (values[index].get(x) / total) * 100
        : (index === series.length - 1 ? 100 : 0);
      return { x, y };
    }),
  }));
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node scripts/page.test.mjs`

Expected: **PASS**, including both new `shareSeries` cases.

- [ ] **Step 5: Commit the normalization helper**

```bash
git add lib/page.js scripts/page.test.mjs
git commit -m "Support multi-series share normalization"
```

### Task 2: Render and configure the Drinkit module share

**Files:**
- Modify: `app.js`
- Modify: `drinkit-android/charts.json`
- Create: `scripts/charts.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `shareSeries` from Task 1 and the existing chart spec series order.
- Produces: a Chart.js dataset per share plus a Drinkit spec containing `ui-module-stacks` as the only UI share card.

- [ ] **Step 1: Write the failing chart-spec test**

Create `scripts/charts.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const charts = JSON.parse(await readFile(path.join(ROOT, "drinkit-android/charts.json"), "utf8"));

test("Drinkit UI module stacks are the only UI share chart", () => {
  const shares = charts.filter(({ group, kind }) => group === "UI" && kind === "share");
  assert.deepEqual(shares.map(({ id, series }) => ({ id, series })), [{
    id: "ui-module-stacks",
    series: ["Modules:ComposeOnly", "Modules:Mixed", "Modules:ViewOnly"],
  }]);
  assert.equal(charts.some(({ id }) => id === "ui-typography" || id === "ui-colors"), false);
});
```

Append `&& node scripts/charts.test.mjs` to the `test` script in `package.json`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/charts.test.mjs`

Expected: **FAIL** because `ui-module-stacks` is still `line` and both obsolete chart ids remain.

- [ ] **Step 3: Generalize the renderer and update the spec**

Import `shareSeries` in `app.js`, then replace the two-series body of `shareChart` with:

```js
function shareChart(canvas, spec, byName, bounds) {
  const colors = palette();
  const normalized = shareSeries(spec.series.map((name) => byName.get(name)));
  return stack100(canvas, normalized.map(({ name, points }, index) => ({
    label: nameOf(name),
    data: points,
    borderColor: colors[index % colors.length],
    backgroundColor: hexA(colors[index % colors.length], 0.78),
    borderWidth: 0,
    pointRadius: 0,
    fill: index === 0 ? "origin" : "-1",
    tension: 0,
  })), bounds);
}
```

In `drinkit-android/charts.json`, set `ui-module-stacks.kind` to `share`, update its note to `share of UI modules by what they contain: @Composable only, res/layout only, or both`, and remove the complete `ui-typography` and `ui-colors` objects.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
node scripts/charts.test.mjs
npm test
npm run typography
bash scripts/build-fixture-test.sh
bash scripts/layout-dry-run.sh
```

Expected: every command exits 0; the scripts report all tests/checks passed.

- [ ] **Step 5: Build a local Drinkit preview and inspect it**

Run `bash scripts/preview.sh` with the configured code-metrics credentials.

Expected: `Modules by UI stack` is a three-area 100% share chart; the Text styles and Colors cards are absent; Architecture, Tests, Tech debt, Codebase, roadmap, and footer sections remain present.

- [ ] **Step 6: Commit the renderer and chart configuration**

```bash
git add app.js drinkit-android/charts.json scripts/charts.test.mjs package.json
git commit -m "Show Drinkit UI stacks as shares"
```

## PR Size

Estimated reviewable footprint: about 120 added + removed lines across JavaScript,
JSON, and `package.json`. Documentation is excluded. This is within the 600-line
target and ships as one PR.
