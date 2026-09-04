// The multi-app layout, checked on a two-app fixture and on the real apps.json:
// root redirect, per-app pages, the switcher, relative-only links, og cards, and
// that no generated page is tracked. `node scripts/layout.test.mjs`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { mascotHtml, render, SITE } from "./render-pages.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

const FIXTURE = [
  {
    dir: "alpha",
    repo: "org/alpha-app",
    name: "Alpha",
    eyebrow: "Org · Alpha",
    heading: "Alpha Engineering",
    title: "Alpha—Engineering",
    description: "Alpha description.",
    ogTitle: "Alpha Engineering — Org",
    ogDescription: "Alpha og description.",
    lede: "A live look at the",
    roadmap: true,
  },
  {
    dir: "beta",
    repo: "org/beta-app",
    name: "Beta",
    eyebrow: "Org · Beta",
    heading: "Beta Engineering",
    title: "Beta—Engineering",
    description: "Beta description.",
    ogTitle: "Beta Engineering — Org",
    ogDescription: "Beta og description.",
    lede: "A live look at the",
    roadmap: false,
  },
];
const ALPHA_SECTIONS = '<section id="more"><h2>Alpha extras</h2></section>';
const ALPHA_MASCOT = '      <button id="mascot" class="egg-mascot" type="button" aria-label="Crab">\u{1F980}</button>';

async function renderFixture() {
  const src = await mkdtemp(path.join(os.tmpdir(), "layout-src-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "layout-out-"));
  await writeFile(path.join(src, "apps.json"), JSON.stringify(FIXTURE));
  await mkdir(path.join(src, "alpha"));
  await writeFile(path.join(src, "alpha", "sections.html"), ALPHA_SECTIONS);
  await writeFile(path.join(src, "alpha", "mascot.html"), ALPHA_MASCOT);
  await render({ appsPath: path.join(src, "apps.json"), out });
  const page = (p) => readFile(path.join(out, p), "utf8");
  return { out, root: await page("index.html"), alpha: await page("alpha/index.html"), beta: await page("beta/index.html") };
}

async function renderReal() {
  const out = await mkdtemp(path.join(os.tmpdir(), "layout-real-"));
  await render({ appsPath: path.join(ROOT, "apps.json"), out });
  return { root: await readFile(path.join(out, "index.html"), "utf8"), dodoIos: await readFile(path.join(out, "dodo-ios/index.html"), "utf8") };
}

const meta = (html, prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];
const controls = (html) => html.match(/<div id="controls">([\s\S]*?)<\/div>/)[1];

test("AC-1 root redirects to the first app in three ways plus a visible link", async () => {
  const { root } = await renderFixture();
  assert.match(root, /<link rel="canonical" href="alpha\/">/);
  assert.match(root, /<meta http-equiv="refresh" content="0; url=alpha\/">/);
  assert.match(root, /location\.replace\(`alpha\//);
  assert.match(root, /<a href="alpha\/">Alpha<\/a>/);
});

test("AC-2 root keeps the first app's og tags as published before the layout change", async () => {
  const { root } = await renderReal();
  assert.equal(meta(root, "og:title"), "iOS Engineering — Dodo Pizza");
  assert.equal(meta(root, "og:description"), "Beta builds, open source, tech radar, and live code metrics for the Dodo Pizza iOS app.");
  assert.equal(meta(root, "og:url"), SITE);
  assert.equal(meta(root, "og:image"), `${SITE}og.png`);
});

test("AC-3 root redirect carries the fragment along", async () => {
  const { root } = await renderFixture();
  assert.match(root, /location\.replace\(`alpha\/\$\{location\.hash\}`\)/);
});

test("AC-4 an app page loads the shared stylesheet and bundle one level up", async () => {
  const { alpha } = await renderFixture();
  assert.match(alpha, /<link rel="stylesheet" href="\.\.\/style\.css">/);
  assert.match(alpha, /<script src="\.\.\/bundle\.js"><\/script>/);
  assert.doesNotMatch(alpha, /href="style\.css"|src="bundle\.js"/);
});

test("AC-5 no root-absolute paths anywhere a page or the stylesheet points", async () => {
  const { root, alpha, beta } = await renderFixture();
  const css = await readFile(path.join(ROOT, "style.css"), "utf8");
  for (const html of [root, alpha, beta]) assert.doesNotMatch(html, /(href|src)="\//);
  assert.doesNotMatch(css, /url\(\s*["']?\//);
});

test("AC-6 the controls bar carries a link switcher with aria-current on the current app", async () => {
  const { alpha, beta } = await renderFixture();
  for (const [html, current] of [[alpha, "alpha"], [beta, "beta"]]) {
    const bar = controls(html);
    assert.match(bar, /<nav class="apps" aria-label="App">/);
    assert.match(bar, /<a href="\.\.\/alpha\/"/);
    assert.match(bar, /<a href="\.\.\/beta\/"/);
    assert.equal((bar.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(bar, new RegExp(`<a href="\\.\\./${current}/" aria-current="page">`));
    assert.doesNotMatch(bar.match(/<nav[\s\S]*?<\/nav>/)[0], /<select/);
    assert.match(bar, /<label>range <select id="rangepick">/);
  }
});

test("AC-7 one template stamps a page per app, with its own title and sections", async () => {
  const { alpha, beta } = await renderFixture();
  assert.match(alpha, /<title>Alpha—Engineering<\/title>/);
  assert.match(beta, /<title>Beta—Engineering<\/title>/);
  assert.match(alpha, /<!--roadmap:board:start--><!--roadmap:board:end-->/);
  assert.doesNotMatch(beta, /roadmap:board/);
  assert.match(alpha, /Alpha extras/);
  assert.doesNotMatch(beta, /Alpha extras/);
  assert.match(alpha, /<code id="repo">org\/alpha-app<\/code>/);
  assert.match(alpha, /<body data-page-config="">/);
});

test("AC-4 page.json is announced to the page only for the app that has one", async () => {
  const src = await mkdtemp(path.join(os.tmpdir(), "layout-src-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "layout-out-"));
  await writeFile(path.join(src, "apps.json"), JSON.stringify(FIXTURE));
  await mkdir(path.join(src, "alpha"));
  await writeFile(path.join(src, "alpha", "page.json"), "{}");
  await render({ appsPath: path.join(src, "apps.json"), out });
  assert.match(await readFile(path.join(out, "alpha/index.html"), "utf8"), /<body data-page-config="page.json">/);
  assert.match(await readFile(path.join(out, "beta/index.html"), "utf8"), /<body data-page-config="">/);
});

test("slice 3: both real pages carry both apps in the switcher, and the Android page is its own", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "layout-real-"));
  await render({ appsPath: path.join(ROOT, "apps.json"), out });
  const ios = await readFile(path.join(out, "dodo-ios/index.html"), "utf8");
  const android = await readFile(path.join(out, "drinkit-android/index.html"), "utf8");
  for (const html of [ios, android]) {
    assert.match(controls(html), /<a href="\.\.\/dodo-ios\/"/);
    assert.match(controls(html), /<a href="\.\.\/drinkit-android\/"/);
    assert.equal((controls(html).match(/aria-current="page"/g) ?? []).length, 1);
  }
  assert.match(controls(android), /<a href="\.\.\/drinkit-android\/" aria-current="page">Drinkit Android<\/a>/);
  assert.match(android, /<title>Drinkit Android—Engineering<\/title>/);
  assert.match(android, /<code id="repo">dodobrands\/drinkit-mobile-android<\/code>/);
  assert.match(android, /<body data-page-config="page.json">/);
  assert.match(android, /<h2>Tools<\/h2>/);
  assert.match(android, /<h2>Team<\/h2>/);
  assert.match(android, /<h2>Media<\/h2>/);
  // A channel is listed under its own title, escaped here so this file itself stays Latin
  // (\u041c\u043e\u0431\u0438\u043b\u044c\u043d\u043e\u0435 \u0427\u0442\u0438\u0432\u043e). The author is the line's second half.
  assert.match(
    android,
    /<a href="https:\/\/t\.me\/mobilefiction">\u041c\u043e\u0431\u0438\u043b\u044c\u043d\u043e\u0435 \u0427\u0442\u0438\u0432\u043e<\/a><span>Maxim Kachinkin<\/span>/u,
  );
  assert.match(android, /<a href="https:\/\/t\.me\/maxkachinkin">Kachinkin Maxim<\/a><span>Android Tech Lead<\/span>/);
  assert.match(android, /<!--roadmap:board:start--><!--roadmap:board:end-->/);
  // The Android partial must not leak into the iOS page; the person is the marker, not the heading.
  assert.doesNotMatch(ios, /mobilefiction/);
});

test("slice 3: the footer mascot is the app's own, and an app without one keeps the dodo", async () => {
  const { alpha, beta } = await renderFixture();
  assert.match(alpha, /<button id="mascot" class="egg-mascot" type="button" aria-label="Crab">\u{1F980}<\/button>/u);
  assert.match(beta, /<button id="mascot" class="egg-mascot" type="button" aria-label="Dodo">\u{1F9A4}<\/button>/u);
  // The bubble the script writes into is the shared half, so every page carries it once.
  for (const html of [alpha, beta]) {
    assert.equal((html.match(/id="mascot-bubble"/g) ?? []).length, 1);
  }
});

test("slice 3: an empty mascot partial falls back, one without the id is rejected", () => {
  assert.match(mascotHtml("alpha", ""), /aria-label="Dodo"/);
  assert.match(mascotHtml("alpha", "  \n "), /aria-label="Dodo"/);
  assert.throws(() => mascotHtml("alpha", '<button id="whale">x</button>'), /alpha\/mascot\.html needs/);
});

test("slice 3: the Android page wears the whale, drawn and theme-inked, and the iOS page the dodo", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "layout-mascot-"));
  await render({ appsPath: path.join(ROOT, "apps.json"), out });
  const ios = await readFile(path.join(out, "dodo-ios/index.html"), "utf8");
  const android = await readFile(path.join(out, "drinkit-android/index.html"), "utf8");
  assert.match(android, /<button id="mascot" class="egg-mascot" type="button" aria-label="Whale">/);
  // Decorative next to a labelled button, and inked from the button so it follows the theme.
  assert.match(android, /<svg viewBox="0 0 64 64"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.match(android, /<path fill="currentColor"/);
  assert.doesNotMatch(android, /\u{1F9A4}/u);
  assert.match(ios, /<button id="mascot" class="egg-mascot" type="button" aria-label="Dodo">\u{1F9A4}<\/button>/u);
});

test("AC-9 generated pages are ignored, never tracked, and preview.sh no longer restores index.html", async () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  assert.deepEqual(tracked.filter((f) => /^([^/]+\/)?index\.html$/.test(f)), []);
  for (const f of ["index.html", "dodo-ios/index.html"]) {
    execFileSync("git", ["check-ignore", "-q", f], { cwd: ROOT });
  }
  const preview = await readFile(path.join(ROOT, "scripts/preview.sh"), "utf8");
  assert.doesNotMatch(preview, /git checkout -- index\.html/);
  const template = await readFile(path.join(ROOT, "templates/app.html"), "utf8");
  assert.match(template, /<!--roadmap:board:start--><!--roadmap:board:end-->/);
  assert.match(template, /<!--roadmap:dialogs:start--><!--roadmap:dialogs:end-->/);
});

test("AC-10 every app has its own og card, and its page points at it", async () => {
  const apps = JSON.parse(await readFile(path.join(ROOT, "apps.json"), "utf8"));
  const cards = JSON.parse(await readFile(path.join(ROOT, "og.json"), "utf8")).cards.map((c) => c.output);
  for (const app of apps) assert.ok(cards.includes(`${app.dir}/og.png`), `og.json has no card for ${app.dir}`);
  assert.ok(cards.includes("og.png"), "og.json has no card for the root redirect page");
  const { dodoIos } = await renderReal();
  assert.equal(meta(dodoIos, "og:image"), `${SITE}dodo-ios/og.png`);
  assert.equal(meta(dodoIos, "og:url"), `${SITE}dodo-ios/`);
});
