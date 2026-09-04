#!/usr/bin/env node
// Guard: this dashboard is a public English-language page, so every letter in
// its sources must be Latin. Scans every tracked file and fails (exit 1) if any
// letter belongs to another script (Cyrillic, Greek, CJK…) — catches an
// accidental Russian phrase, label, or comment before it ships.
//
// Every tracked file is checked; binary files (detected by a NUL byte) are
// skipped. Only *letters* are constrained — digits, punctuation, whitespace and
// symbols (emoji 🦤, arrows →, dashes —, ellipses …, curly quotes) are allowed,
// because they aren't letters and carry no language.
//
// One exemption, as narrow as it can be: in an app's own sections.html, the text
// *inside a link* may be a proper noun in its own script — a channel's title
// translated leaves the reader unable to recognise what they are clicking. Only
// that text is skipped; the prose around it, and every other file, stays Latin.
//
//   node scripts/latin-only.mjs   # check — exit 1 and list the offenders
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
const LINK_TEXT = /(?<=<a\b[^>]*>)[^<]*(?=<\/a>)/g;

// What of a line the guard reads: everything, minus the link text of an app's own
// sections.html. The app directories come from apps.json, so a sections.html
// anywhere else — templates/, a future tool's fixture — stays fully guarded.
export function scanner(appDirs) {
  const exempt = new Set(appDirs.map((dir) => `${dir}/sections.html`));
  return (file, line) => (exempt.has(file) ? line.replace(LINK_TEXT, "") : line);
}

function nonLatinLetter(line) {
  for (const ch of line) {
    if (LETTER.test(ch) && !LATIN.test(ch)) return ch;
  }
  return null;
}

// Importing this module must not scan — the test imports `scanner` from it.
function check() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const scanned = scanner(JSON.parse(readFileSync(path.join(ROOT, "apps.json"), "utf8")).map((app) => app.dir));

  let bad = 0;
  for (const file of tracked) {
    const buf = readFileSync(path.join(ROOT, file));
    if (buf.includes(0)) continue; // binary file — skip
    buf.toString("utf8").split("\n").forEach((line, i) => {
      const ch = nonLatinLetter(scanned(file, line));
      if (ch) {
        bad++;
        console.log(`${file}:${i + 1}: non-Latin letter ${JSON.stringify(ch)} — ${line.trim().slice(0, 80)}`);
      }
    });
  }

  if (bad) {
    console.error(`\n${bad} line(s) have non-Latin letters. This is a public English page — keep every letter Latin.`);
    process.exit(1);
  }
  console.log("latin-only OK");
}

if (process.argv[1] === new URL(import.meta.url).pathname) check();
