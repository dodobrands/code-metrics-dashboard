// The per-app page config (page.json): labels, group notes, the declarative hero, and
// what happens without the file. `node scripts/page.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { heroThesis, labeller, loadPage, sectionNote } from "../lib/page.js";

const BUILTIN = { "@available(*, deprecated": "@available deprecated", "Snapshot:All:Covered": "Covered" };

test("AC-1 labels: app map wins, built-in stays, unknown name passes through", () => {
  const nameOf = labeller(BUILTIN, { "<(fragment|dialog|activity)\\b": "Nav2 destinations", "Snapshot:All:Covered": "Has a snapshot" });
  assert.equal(nameOf("<(fragment|dialog|activity)\\b"), "Nav2 destinations");
  assert.equal(nameOf("Snapshot:All:Covered"), "Has a snapshot");
  assert.equal(nameOf("@available(*, deprecated"), "@available deprecated");
  assert.equal(nameOf("Tests:Unit"), "Tests:Unit");
  assert.equal(labeller(BUILTIN)("Snapshot:All:Covered"), "Covered");
});

test("AC-2 group note renders under the heading, escaped, only when present", () => {
  const notes = { UI: "Compose adoption & how much <styling> comes from the design system" };
  assert.equal(sectionNote(notes, "UI"), '<p class="section-note">Compose adoption &amp; how much &lt;styling&gt; comes from the design system</p>');
  assert.equal(sectionNote(notes, "Tests"), "");
  assert.equal(sectionNote(undefined, "UI"), "");
});

const PAGE = {
  hero: {
    chart: "ui-module-stacks",
    noun: "UI modules",
    parts: [
      { series: "Modules:ComposeOnly", text: "are Compose-only" },
      { series: "Modules:Mixed", text: "mix Compose and Views", class: "mixed" },
    ],
  },
};
const DATA = {
  "ui-module-stacks": {
    series: [
      { name: "Modules:ComposeOnly", points: [[1, 20], [2, 28]] },
      { name: "Modules:Mixed", points: [[1, 40], [2, 50]] },
      { name: "Modules:ViewOnly", points: [[1, 12], [2, 11]] },
    ],
  },
};

test("AC-3 hero: declarative shares from the chart's last values", () => {
  assert.equal(
    heroThesis({}, PAGE, DATA),
    '<span class="hero-stat"><b>31%</b> of 89 UI modules are Compose-only, <b class="mixed">56%</b> mix Compose and Views</span>',
  );
  assert.equal(heroThesis({}, PAGE, { "ui-module-stacks": { series: [] } }), "");
});

test("AC-3 hero: no page.hero keeps the Swift 6 thesis", () => {
  const meta = { hero: { swift6Pct: 100, swift6Total: 65 } };
  assert.equal(heroThesis(meta, {}), '<span class="hero-stat"><b>100%</b> of 65 modules on Swift 6</span>');
  assert.equal(heroThesis(meta, undefined), '<span class="hero-stat"><b>100%</b> of 65 modules on Swift 6</span>');
  assert.equal(heroThesis({ hero: {} }, {}), "");
});

test("AC-4 loadPage: a 404 yields an empty config, so does a network error", async () => {
  assert.deepEqual(await loadPage(async () => ({ ok: false, status: 404 })), {});
  assert.deepEqual(await loadPage(async () => { throw new TypeError("Failed to fetch"); }), {});
  const page = await loadPage(async () => ({ ok: true, json: async () => ({ labels: { a: "A" } }) }));
  assert.deepEqual(page, { labels: { a: "A" } });
});

test("AC-4 loadPage: an app without page.json (empty data-page-config) fetches nothing", async () => {
  let calls = 0;
  assert.deepEqual(await loadPage(async () => { calls++; return { ok: true, json: async () => ({}) }; }, ""), {});
  assert.equal(calls, 0);
});
