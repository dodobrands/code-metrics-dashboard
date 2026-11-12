import assert from "node:assert/strict";
import { test } from "node:test";
import { columnKey, markdown, progress } from "./kaiten-roadmap.mjs";

test("Kaiten column type picks the roadmap column; Cancelled is dropped", () => {
  assert.equal(columnKey({ title: "Backlog", type: 1 }), "backlog");
  assert.equal(columnKey({ title: "Delivery", type: 2 }), "progress");
  assert.equal(columnKey({ title: "Post Analysis", type: 2 }), "progress");
  assert.equal(columnKey({ title: "Done", type: 3 }), "done");
  assert.equal(columnKey({ title: "Cancelled", type: 2 }), null);
});

test("progress counts leaf tasks: an epic's children, a project's epics' children", () => {
  assert.equal(progress([]), null);
  assert.equal(progress([{ children_count: 0, state: 3 }, { children_count: 0, state: 2 }]), 0.5);
  // a project: one epic with 3 of 4 done, plus one done task directly under it
  assert.equal(progress([{ children_count: 4, children_done: 3, state: 2 }, { children_count: 0, state: 3 }]), 0.8);
});

test("markdown: paragraphs, lists, inline marks, links; HTML is escaped", () => {
  assert.equal(markdown("One line\nwraps.\n\nSecond."), "<p>One line wraps.</p> <p>Second.</p>");
  assert.equal(markdown("- **a** b\n- `c`"), "<ul><li><b>a</b> b</li><li><code>c</code></li></ul>");
  assert.equal(markdown("1. x\n2. y"), "<ol><li>x</li><li>y</li></ol>");
  assert.equal(markdown("[Swift](https://swift.org) <script>"), '<p><a href="https://swift.org">Swift</a> &lt;script&gt;</p>');
  assert.equal(markdown("[bad](javascript:alert(1))"), "<p>[bad](javascript:alert(1))</p>");
  assert.equal(markdown(" \n"), "");
});
