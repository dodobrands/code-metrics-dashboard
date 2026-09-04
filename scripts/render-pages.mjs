#!/usr/bin/env node
// Stamps the pages: one <dir>/index.html per app in apps.json from templates/app.html,
// and the root index.html — a redirect to the first app — from templates/root.html.
//
//   node scripts/render-pages.mjs                      # repo root: apps.json → ./<dir>/index.html, ./index.html
//   node scripts/render-pages.mjs --apps <path> --out <dir>
//
// The footer easter egg is the app's own: <dir>/mascot.html is the button and
// <dir>/phrases.json its lines; an app without them gets the dodo and the shared list
// the site started with. app.js wires the tap by id, so a partial that drops it is
// rejected here rather than shipping a dead egg.
//
// The site is a project-path Pages site (github.io/<repo>/), so every link the pages
// carry is relative: apps link to each other as ../<dir>/, and to the shared bundle
// and stylesheet one level up. The build tools resolve charts.json, data/ and
// index.html against their working directory, which is why each app has a directory.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SITE = "https://dodobrands.github.io/code-metrics-dashboard/";
const DODO_MASCOT = '      <button id="mascot" class="egg-mascot" type="button" aria-label="Dodo">🦤</button>';
const ROOT = path.resolve(import.meta.dirname, "..");

export function navHtml(apps, current) {
  const links = apps.map((app) => {
    const here = app.dir === current.dir ? ' aria-current="page"' : "";
    return `<a href="../${app.dir}/"${here}>${app.name}</a>`;
  });
  return `<nav class="apps" aria-label="App">${links.join("")}</nav>`;
}

// <!--if:flag-->…<!--endif:flag--> keeps the block when the app has the flag, drops it otherwise.
export function conditional(html, flag, on) {
  const re = new RegExp(`<!--if:${flag}-->([\\s\\S]*?)<!--endif:${flag}-->`, "g");
  return html.replace(re, (_, body) => (on ? body : ""));
}

export function fill(html, vars) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template needs {{${key}}}, apps.json has no such field`);
    return vars[key];
  });
}

// A declared list must actually hold lines. The page falls back to the shared list when
// it cannot use one, and that list is the dodo's — the wrong voice for any other mascot —
// so an empty or malformed list fails the build instead of shipping silently.
export function phrasesDeclaration(dir, raw) {
  if (!raw.trim()) return "";
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    throw new Error(`${dir}/phrases.json is not valid JSON`);
  }
  const usable = Array.isArray(list) && list.length && list.every((line) => typeof line === "string" && line.trim());
  if (!usable) throw new Error(`${dir}/phrases.json must be a non-empty array of non-empty strings`);
  return "phrases.json";
}

export function mascotHtml(dir, partial) {
  const html = partial.trimEnd();
  if (!html) return DODO_MASCOT;
  if (!html.includes('id="mascot"')) throw new Error(`${dir}/mascot.html needs the button to carry id="mascot"`);
  return html;
}

async function readIfExists(file) {
  return access(file).then(() => readFile(file, "utf8"), () => "");
}

export async function render({ appsPath, out }) {
  const src = path.dirname(appsPath);
  const apps = JSON.parse(await readFile(appsPath, "utf8"));
  if (!apps.length) throw new Error(`${appsPath} lists no apps`);
  const appTemplate = await readFile(path.join(ROOT, "templates", "app.html"), "utf8");
  const rootTemplate = await readFile(path.join(ROOT, "templates", "root.html"), "utf8");

  const written = [];
  for (const app of apps) {
    const sections = await readIfExists(path.join(src, app.dir, "sections.html"));
    const mascot = mascotHtml(app.dir, await readIfExists(path.join(src, app.dir, "mascot.html")));
    // The page fetches these only when told they exist, so an app without one costs no 404.
    const pageConfig = await access(path.join(src, app.dir, "page.json")).then(() => "page.json", () => "");
    const phrases = phrasesDeclaration(app.dir, await readIfExists(path.join(src, app.dir, "phrases.json")));
    const vars = { ...app, site: SITE, nav: navHtml(apps, app), sections, mascot, pageConfig, phrases };
    const html = fill(conditional(appTemplate, "roadmap", Boolean(app.roadmap)), vars);
    const file = path.join(out, app.dir, "index.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    written.push(file);
  }
  const root = path.join(out, "index.html");
  await writeFile(root, fill(rootTemplate, { ...apps[0], site: SITE }));
  written.push(root);
  return written;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? fallback : process.argv[i + 1];
  };
  const written = await render({
    appsPath: path.resolve(arg("--apps", path.join(ROOT, "apps.json"))),
    out: path.resolve(arg("--out", ROOT)),
  });
  for (const f of written) console.log(`wrote ${path.relative(process.cwd(), f)}`);
}
