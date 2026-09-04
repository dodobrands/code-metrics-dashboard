#!/usr/bin/env node
import { access, readdir, readFile, writeFile } from "node:fs/promises";
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
// Tags are skipped whole, and so are <script>/<style> bodies: code, not prose.
const typoHtml = (s) =>
  s
    .split(/(<(?:script|style)\b[\s\S]*?<\/(?:script|style)>|<[^>]*>)/)
    .map((part) => (part.startsWith("<") ? part : typoText(part)))
    .join("");

// Everything authored lives in apps.json, the page templates, and per app: its
// charts.json, its optional sections.html partial, and its roadmap cards.
async function targets() {
  const apps = JSON.parse(await readFile(path.join(ROOT, "apps.json"), "utf8"));
  const list = [
    { path: path.join(ROOT, "apps.json"), kind: "apps" },
    { path: path.join(ROOT, "phrases.json"), kind: "phrases" },
    { path: path.join(ROOT, "templates", "app.html"), kind: "html" },
    { path: path.join(ROOT, "templates", "root.html"), kind: "html" },
  ];
  for (const app of apps) {
    const dir = path.join(ROOT, app.dir);
    list.push({ path: path.join(dir, "charts.json"), kind: "charts" });
    const sections = path.join(dir, "sections.html");
    if (await access(sections).then(() => true, () => false)) list.push({ path: sections, kind: "html" });
    const page = path.join(dir, "page.json");
    if (await access(page).then(() => true, () => false)) list.push({ path: page, kind: "page" });
    if (!app.roadmap) continue;
    const cards = (await readdir(path.join(dir, "roadmap"))).filter((f) => f.endsWith(".json") && f !== "index.json");
    list.push(...cards.map((f) => ({ path: path.join(dir, "roadmap", f), kind: "roadmap" })));
  }
  return list;
}

// Only what lands in a text node. title/description/og* become attribute values and the
// <title>, which the HTML pass never typographed either — and the og tags must stay
// byte-identical to what is already shared.
const APP_TEXT = ["name", "eyebrow", "heading", "lede"];

function fixed(kind, raw) {
  if (kind === "html") return typoHtml(raw);
  if (kind === "apps") {
    const arr = JSON.parse(raw);
    for (const app of arr) for (const k of APP_TEXT) if (app[k]) app[k] = fixTypos(app[k], LOCALE);
    return `${JSON.stringify(arr, null, 2)}\n`;
  }
  if (kind === "page") {
    // Notes and the hero are prose; labels are names of series and stay verbatim.
    const page = JSON.parse(raw);
    for (const k of Object.keys(page.groupNotes ?? {})) page.groupNotes[k] = fixTypos(page.groupNotes[k], LOCALE);
    if (page.hero?.noun) page.hero.noun = fixTypos(page.hero.noun, LOCALE);
    for (const part of page.hero?.parts ?? []) part.text = fixTypos(part.text, LOCALE);
    return `${JSON.stringify(page, null, 2)}\n`;
  }
  if (kind === "phrases") {
    const arr = JSON.parse(raw);
    return `${JSON.stringify(arr.map((s) => fixTypos(s, LOCALE)), null, 2)}\n`;
  }
  if (kind === "charts") {
    // Chart titles and notes are authored prose; series names are code and stay
    // verbatim (they aren't touched here).
    const arr = JSON.parse(raw);
    for (const c of arr) {
      if (c.title) c.title = fixTypos(c.title, LOCALE);
      if (c.note) c.note = fixTypos(c.note, LOCALE);
    }
    return `${JSON.stringify(arr, null, 2)}\n`;
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
