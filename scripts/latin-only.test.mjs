// The one exemption in the Latin-only guard: link text in an app's sections.html.
// The Cyrillic samples are written as escapes, so this file passes the guard it tests.
// `node scripts/latin-only.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scanner } from "./latin-only.mjs";

const scanned = scanner(["dodo-ios", "drinkit-android"]);
const SECTIONS = "drinkit-android/sections.html";
const CHANNEL = "\u041C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0435 \u0427\u0442\u0438\u0432\u043E"; // a channel's own title
const CYRILLIC = /\p{Script=Cyrillic}/u;

test("a channel's own title is exempt, the note beside it is not", () => {
  const titled = `<li><a href="https://t.me/mobilefiction">${CHANNEL}</a><span>Maxim Kachinkin</span></li>`;
  assert.doesNotMatch(scanned(SECTIONS, titled), CYRILLIC);

  const noted = `<li><a href="https://t.me/mobilefiction">${CHANNEL}</a><span>\u0410\u0432\u0442\u043E\u0440</span></li>`;
  assert.match(scanned(SECTIONS, noted), CYRILLIC);
});

test("prose outside a link stays guarded, even in an exempt file", () => {
  const heading = `<div class="section-head"><h2>\u041C\u0435\u0434\u0438\u0430</h2></div>`;
  assert.equal(scanned(SECTIONS, heading), heading);
});

test("only the sections.html of a directory in apps.json is exempt", () => {
  const line = `<a href="#">${CHANNEL}</a>`;
  for (const file of ["sections.html", "templates/sections.html", "phrases.json", "app.js"]) {
    assert.equal(scanned(file, line), line, file);
  }
  assert.doesNotMatch(scanned("dodo-ios/sections.html", line), CYRILLIC);
});
