#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
// Typography lint: verifies every authored text in the repo is already
// typographed (curly quotes/apostrophes, ellipsis, dashes, spacing) via typopo.
//
//   node scripts/typography.mjs        # check — exit 1 if anything is off
//   node scripts/typography.mjs --fix  # rewrite sources with the fixes
//
// HTML is handled tag-aware: only text nodes are typographed, tags and
// attributes (e.g. href="…") are left untouched; edge whitespace around inline
// tags is preserved.
import { fixTypos } from "typopo";

const LOCALE = "en-us";
const ROOT = path.resolve(import.meta.dirname, "..");

const typoText = (t) => {
  const [, lead, core, trail] = t.match(/^(\s*)([\s\S]*?)(\s*)$/s);
  return lead + (core ? fixTypos(core, LOCALE) : "") + trail;
};
const typoHtml = (s) =>
  s.split(/(<[^>]*>)/).map((part) => (part.startsWith("<") ? part : typoText(part))).join("");

async function targets() {
  const dir = path.join(ROOT, "roadmap");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "index.json");
  const list = files.map((f) => ({ path: path.join(dir, f), kind: "roadmap" }));
  list.push({ path: path.join(ROOT, "index.html"), kind: "html" });
  list.push({ path: path.join(ROOT, "phrases.json"), kind: "phrases" });
  return list;
}

function fixed(kind, raw) {
  if (kind === "html") return typoHtml(raw);
  if (kind === "phrases") {
    const arr = JSON.parse(raw);
    return `${JSON.stringify(arr.map((s) => fixTypos(s, LOCALE)), null, 2)}\n`;
  }
  const json = JSON.parse(raw);
  json.title = fixTypos(json.title, LOCALE);
  json.description = typoHtml(json.description);
  return `${JSON.stringify(json, null, 2)}\n`;
}

const apply = process.argv.includes("--fix");
let bad = 0;
for (const t of await targets()) {
  const raw = await readFile(t.path, "utf8");
  const next = fixed(t.kind, raw);
  if (next === raw) continue;
  const rel = path.relative(ROOT, t.path);
  if (apply) {
    await writeFile(t.path, next);
    console.log("fixed:", rel);
  } else {
    bad++;
    console.log("needs typography:", rel);
  }
}

if (!apply && bad) {
  console.error(`\n${bad} file(s) not typographed. Fix with: node scripts/typography.mjs --fix`);
  process.exit(1);
}
console.log(apply ? "typography applied" : "typography OK");
