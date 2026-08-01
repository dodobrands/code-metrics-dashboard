// The page's typography, shared by app.js (browser) and scripts/typo.test.mjs
// (node). Import-safe for node: the DOM is touched only inside typographize's
// body, never at module top level.
import { fixTypos } from "typopo";

// typopo does quotes/dashes/spacing but does NOT glue prepositions in en-us, so a
// line can end on one. Add a non-breaking space after short function words and
// between a word and a version number, so a line never ends on a preposition
// ("… targets on" / "Swift 6").
const WIDOW = /\b(a|an|and|as|at|but|by|for|from|in|into|nor|of|off|on|onto|or|per|the|to|up|via|vs|with)\b(\s+)(?=\S)/gi;
export const preventWidows = (t) =>
  t.replace(WIDOW, (_m, w) => `${w}\u00A0`).replace(/\b([A-Za-z]+)\s+(\d+)\b/g, "$1\u00A0$2");

// The one text transform: typopo (same lib and en-us locale as the build-time
// lint, idempotent) then widow prevention. Edge whitespace is preserved and only
// the core is typographed, so words don't glue across an inline tag (a text node
// " of 194…" after </b> keeps its leading space).
export const typo = (s) => {
  const [, lead, core, trail] = s.match(/^(\s*)([\s\S]*?)(\s*)$/s);
  return core ? lead + preventWidows(fixTypos(core, "en-us")) + trail : s;
};

// One pass over every text node under `root`. Skips code/pre and anything opted
// out with data-notypo; canvas carries no text nodes. Call it right where text
// is inserted (not in a late callback), so typography lands in the same paint and
// the page doesn't reflow once charts finish.
export const typographize = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue.trim() && !n.parentElement?.closest("script,style,code,pre,[data-notypo]")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const next = typo(n.nodeValue);
    if (next !== n.nodeValue) n.nodeValue = next;
  }
};
