#!/usr/bin/env node
// Guard: this dashboard is a public English-language page, so every letter in
// its sources must be Latin. Scans every tracked text file and fails (exit 1)
// if any letter belongs to another script (Cyrillic, Greek, CJK…) — catches an
// accidental Russian phrase, label, or comment before it ships.
//
// Only *letters* are constrained. Digits, punctuation, whitespace and symbols
// — emoji (🦤), arrows (→), dashes (—), ellipses (…), curly quotes — are all
// allowed, because they aren't letters and carry no language.
//
//   node scripts/latin-only.mjs   # check — exit 1 and list the offenders
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXT = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".yml", ".yaml", ".sh", ".txt", ".swift"]);
const SKIP = [/^node_modules\//, /^data\//, /^\.build\//, /(^|\/)bundle\.js$/, /(^|\/)Package\.resolved$/];

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;

function nonLatinLetter(line) {
  for (const ch of line) {
    if (LETTER.test(ch) && !LATIN.test(ch)) return ch;
  }
  return null;
}

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => EXT.has(path.extname(f)) && !SKIP.some((re) => re.test(f)));

let bad = 0;
for (const file of tracked) {
  const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const ch = nonLatinLetter(line);
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
