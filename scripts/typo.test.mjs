#!/usr/bin/env node
// Locks the page's typography (typo() in ../typo.js) so any regression — a rule
// change on our side, or a typopo update that shifts output — fails CI. Run by
// lint.yml and the pre-commit hook. No test framework: plain node:assert.
import assert from "node:assert/strict";
import { preventWidows, typo } from "../typo.js";

const NB = "\u00A0"; // non-breaking space

// [input, expected] — the full pipeline: typopo (quotes/dashes/ellipsis/spacing,
// number+unit) THEN our widow prevention (function words + word↔version number).
const cases = [
  // widow rule: a line must not end on a preposition/conjunction/article
  ["100% of 194 targets on Swift 6", `100% of${NB}194 targets on${NB}Swift${NB}6`],
  ["Move to a UDF architecture", `Move to${NB}a${NB}UDF architecture`],
  ["Migrate from UIKit to SwiftUI", `Migrate from${NB}UIKit to${NB}SwiftUI`],
  ["SwiftUI vs UIKit", `SwiftUI vs${NB}UIKit`],
  // word ↔ version / number
  ["Drop iOS 16 support", `Drop iOS${NB}16${NB}support`],
  // typopo: curly quotes + apostrophe (+ nbsp after single-letter "a")
  [`it's a "quote"`, `it’s a${NB}“quote”`],
  // typopo: em dash, en-dash range, ellipsis, number+unit
  ["a -- b", "a—b"],
  ["range 1-5", `range${NB}1–5`],
  ["wait...", "wait…"],
  ["5 kg", `5${NB}kg`],
  // edge whitespace preserved — a text node after an inline tag keeps its space
  [" of 194", ` of${NB}194`],
  // intra-word hyphen kept, not turned into a dash
  ["Move to design-system components", `Move to${NB}design-system components`],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = typo(input);
  if (got !== expected) {
    failed++;
    console.error(`FAIL ${JSON.stringify(input)}`);
    console.error(`  expected ${JSON.stringify(expected)}`);
    console.error(`  got      ${JSON.stringify(got)}`);
  }
  // Idempotent: typographing already-typographed text is a no-op, so the runtime
  // pass can't drift the build-time-linted source.
  assert.equal(typo(got), got, `not idempotent: ${JSON.stringify(input)}`);
}

// preventWidows in isolation: every short function word glues to the next word;
// the trailing one has nothing to glue to.
assert.equal(preventWidows("a of on to the top"), `a${NB}of${NB}on${NB}to${NB}the${NB}top`);

if (failed) {
  console.error(`\n${failed} typography case(s) failed — see diffs above`);
  process.exit(1);
}
console.log(`typography: ${cases.length} cases OK`);
