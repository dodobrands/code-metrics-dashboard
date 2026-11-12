import assert from "node:assert/strict";
import { test } from "node:test";
import { columnKey, markdown, metricProgress, progress } from "./kaiten-roadmap.mjs";

test("Kaiten column type picks the roadmap column; Cancelled and missing are dropped", () => {
  assert.equal(columnKey({ title: "Backlog", type: 1 }), "backlog");
  assert.equal(columnKey({ title: "Delivery", type: 2 }), "progress");
  assert.equal(columnKey({ title: "Post Analysis", type: 2 }), "progress");
  assert.equal(columnKey({ title: "Done", type: 3 }), "done");
  assert.equal(columnKey({ title: "Cancelled", type: 2 }), null);
  assert.equal(columnKey(undefined), null);
});

test("progress counts leaf tasks: an epic's children, a project's epics' children", () => {
  assert.equal(progress([]), null);
  assert.equal(progress([{ children_count: 0, state: 3 }, { children_count: 0, state: 2 }]), 0.5);
  // a project: one epic with 3 of 4 done, plus one done task directly under it
  assert.equal(progress([{ children_count: 4, children_done: 3, state: 2 }, { children_count: 0, state: 3 }]), 0.8);
});

test("metric progress: share of the latest values, or burndown from the peak", () => {
  const series = {
    Testing: [[1, 0], [2, 30], [3, 75]],
    XCTest: [[1, 100], [2, 70], [3, 25]],
    storyboard: [[1, 40], [3, 10]],
    xib: [[2, 60], [3, 20]],
  };
  assert.equal(metricProgress({ done: ["Testing"], left: ["XCTest"] }, series), 0.75);
  // peak sum is at t=2 (40 + 60), latest is 10 + 20
  assert.equal(metricProgress({ burndown: ["storyboard", "xib"] }, series), 0.7);
  assert.equal(metricProgress({ done: ["Nope"], left: ["Missing"] }, series), null);
  assert.equal(metricProgress({ burndown: ["Missing"] }, {}), null);
});

test("markdown: paragraphs, lists, inline marks, links; HTML is escaped", () => {
  assert.equal(markdown("One line\nwraps.\n\nSecond."), "<p>One line wraps.</p> <p>Second.</p>");
  assert.equal(markdown("- **a** b\n- `c`"), "<ul><li><b>a</b> b</li><li><code>c</code></li></ul>");
  assert.equal(markdown("1. x\n2. y"), "<ol><li>x</li><li>y</li></ol>");
  assert.equal(markdown("Intro:\n- a\n- b"), "<p>Intro:</p> <ul><li>a</li><li>b</li></ul>");
  assert.equal(markdown("[Swift](https://swift.org) <script>"), '<p><a href="https://swift.org">Swift</a> &lt;script&gt;</p>');
  assert.equal(markdown("[x](https://x.io/*a*/b*c)"), '<p><a href="https://x.io/*a*/b*c">x</a></p>');
  assert.equal(markdown("[x](https://x.y/a(b)c)."), '<p><a href="https://x.y/a(b)c">x</a>.</p>');
  assert.equal(markdown("[bad](javascript:alert(1))"), "<p>[bad](javascript:alert(1))</p>");
  assert.equal(markdown('[q](https://x.io/"onmouseover=alert(1))'), '<p><a href="https://x.io/&quot;onmouseover=alert(1)">q</a></p>');
  assert.equal(markdown(" \n"), "");
});
