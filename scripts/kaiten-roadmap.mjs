#!/usr/bin/env node
// Pulls an app's roadmap from Kaiten into <dir>/roadmap/kaiten/ — gitignored, rebuilt
// on every deploy. An app with roadmap/kaiten.json takes its roadmap from Kaiten only;
// its hand-written roadmap/index.json, if any, is ignored (see build-roadmap).
//
// roadmap/kaiten.json is { "filters": [ { …GET /cards params } ] }. Each filter is
// passed to Kaiten as is (board_id, lane_id, type_id, tag_ids…), so a project narrows
// its cards however it needs. Of what the filters return, only cards with "Roadmap:
// publish" ticked are published, under their "Roadmap: title (EN)" and "Roadmap:
// description (EN)" (Markdown). Kaiten's column type picks the roadmap column: queue →
// Backlog, done → Done, anything in between → In Progress. Progress is the share of
// done children; a child with children of its own (an epic inside a project) counts as
// its children, so a project's progress is its epics' tasks.
//
//   KAITEN_URL=https://<company>.kaiten.ru/api/latest KAITEN_TOKEN=… node scripts/kaiten-roadmap.mjs <dir>
//
// KAITEN_URL is the repository variable of the same name, KAITEN_TOKEN the secret. The
// script never fails the build: if the pull fails for any reason — no token, Kaiten
// down, zero ticked cards — it writes nothing, warns, and the page goes out without a
// roadmap rather than with a wrong or half one.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.KAITEN_URL;
export const PROP = { publish: "id_681824", title: "id_681825", description: "id_681826" };
const PAGE = 100;
const TITLES = { backlog: "Backlog", progress: "In Progress", done: "Done" };

// Kaiten column types: 1 queue, 2 in progress, 3 done.
export function columnKey(column) {
  if (!column) return null;
  if (/cancel/i.test(column.title ?? "")) return null; // the Projects board parks dropped projects in a type-2 "Cancelled"
  return { 1: "backlog", 3: "done" }[column.type] ?? "progress";
}

export function progress(children) {
  let done = 0, total = 0;
  for (const c of children) {
    if (c.children_count > 0) { done += c.children_done ?? 0; total += c.children_count; }
    else { done += c.state === 3 ? 1 : 0; total += 1; }
  }
  return total ? done / total : null;
}

// A series' value at time t: its last point at or before t (0 before it starts).
const at = (points, t) => {
  let v = 0;
  for (const [ts, y] of points) if (ts <= t) v = y; else break;
  return v;
};

// Progress from the dashboard's own chart data, for cards whose work a metric measures
// better than Kaiten's task split — only those listed by id under "progressSource" in
// roadmap/kaiten.json. A rule is one of
//   { chart, done: [series…], left: [series…] }  → done / (done + left), latest values
//   { chart, burndown: [series…] }                → 1 − latest sum / peak sum
// `series` maps a series name to its [[timestamp, value]…] points. null when the
// chart has none of the named series, so the caller can fall back to Kaiten.
export function metricProgress(rule, series) {
  const names = rule.burndown ?? [...rule.done, ...rule.left];
  if (!names.some((n) => series[n]?.length)) return null;
  const times = [...new Set(names.flatMap((n) => (series[n] ?? []).map(([t]) => t)))].sort((a, b) => a - b);
  const sum = (list, t) => list.reduce((s, n) => s + at(series[n] ?? [], t), 0);
  const last = times.at(-1);
  if (rule.burndown) {
    const peak = Math.max(...times.map((t) => sum(rule.burndown, t)));
    return peak ? 1 - sum(rule.burndown, last) / peak : null;
  }
  const done = sum(rule.done, last), total = done + sum(rule.left, last);
  return total ? done / total : null;
}

async function chartSeries(dir, chart) {
  const raw = await readFile(path.join(dir, "data", "charts", `${chart}.json`), "utf8").catch(() => null);
  return raw ? Object.fromEntries(JSON.parse(raw).series.map((s) => [s.name, s.points])) : {};
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Links first, parked as placeholders, so a `*` or `(` inside a URL is never read as
// emphasis or cut short; then code, bold, italic on the rest.
const inline = (s) => {
  const links = [];
  const text = escapeHtml(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+?)\)(?=[\s.,;:!?]|$)/g, (_, label, url) => `\uE000${links.push([label, url]) - 1}\uE000`);
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\uE000(\d+)\uE000/g, (_, i) => `<a href="${links[i][1]}">${links[i][0]}</a>`);
};

// The Markdown a Kaiten text field realistically holds: paragraphs, "- " and "1. "
// lists, **bold**, *italic*, `code`, [links](https://…). Everything else is text. A
// list may follow a lead-in line without a blank line between them.
export function markdown(src) {
  if (!src.trim()) return "";
  const kind = (l) => (/^[-*]\s+/.test(l) ? "ul" : /^\d+[.)]\s+/.test(l) ? "ol" : "p");
  const out = [];
  for (const block of src.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; ) {
      const k = kind(lines[i]);
      let j = i;
      while (j < lines.length && kind(lines[j]) === k) j++;
      const run = lines.slice(i, j);
      out.push(k === "p" ? `<p>${inline(run.join(" "))}</p>` : `<${k}>${run.map((l) => `<li>${inline(l.replace(/^([-*]|\d+[.)])\s+/, ""))}</li>`).join("")}</${k}>`);
      i = j;
    }
  }
  return out.join(" ");
}

async function get(token, route) {
  for (let attempt = 1; ; attempt++) {
    let res, failure;
    try {
      res = await fetch(API + route, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res.json();
      failure = `Kaiten ${res.status} on ${route}`;
    } catch (error) {
      failure = `Kaiten unreachable on ${route}: ${error.message}`; // a reset or a timeout is worth a retry
    }
    if (attempt === 4 || (res && res.status !== 429 && res.status < 500)) throw new Error(failure);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function all(token, route, params = {}) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, limit: PAGE, offset });
    const page = await get(token, `${route}?${q}`);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export async function pull(dir, token) {
  const config = JSON.parse(await readFile(path.join(dir, "roadmap", "kaiten.json"), "utf8"));
  const seen = new Map();
  for (const filter of config.filters ?? []) {
    for (const card of await all(token, "/cards", { archived: false, ...filter })) {
      if (card.properties?.[PROP.publish]) seen.set(card.id, card);
    }
  }

  const columns = { backlog: [], progress: [], done: [] };
  const tasks = {};
  for (const card of seen.values()) {
    const key = columnKey(card.column);
    const title = card.properties[PROP.title]?.trim();
    if (!key) continue;
    if (!title) {
      console.warn(`kaiten: card ${card.id} is ticked for the roadmap but has no English title — skipped`); // ids only: the deploy log is public
      continue;
    }
    const task = { title, description: markdown(card.properties[PROP.description] ?? "") };
    if (key === "progress") {
      // Only the cards listed in progressSource take a dashboard metric; the rest, by
      // default, count their Kaiten children.
      const rule = config.progressSource?.[card.id];
      const p = (rule && metricProgress(rule, await chartSeries(dir, rule.chart))) ?? progress(await all(token, `/cards/${card.id}/children`));
      if (p !== null) task.progress = p;
    }
    const id = `kaiten-${card.id}`;
    tasks[id] = task;
    columns[key].push({ id, at: key === "done" ? -(Date.parse(card.last_moved_to_done_at ?? card.updated) || 0) : Date.parse(card.created) || 0 });
  }
  // Done shows the newest first; the other columns keep the order cards were started in.
  const index = {
    columns: Object.entries(columns).map(([key, cards]) => ({ key, title: TITLES[key], items: cards.sort((a, b) => a.at - b.at).map((c) => c.id) })),
  };
  return { index, tasks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  const out = path.join(dir, "roadmap", "kaiten");
  // Nothing in roadmap/kaiten/ is what tells build-roadmap to hide the roadmap, so a
  // run that fails halfway must not leave a stale or partial set behind.
  await rm(out, { recursive: true, force: true });
  const warn = (msg) => console.warn(process.env.CI ? `::warning::${msg}` : msg);
  try {
    if (!process.env.KAITEN_TOKEN || !API) throw new Error("KAITEN_TOKEN or KAITEN_URL is not set");
    const { index, tasks } = await pull(dir, process.env.KAITEN_TOKEN);
    const count = index.columns.reduce((n, c) => n + c.items.length, 0);
    if (!count) throw new Error("no cards are ticked for the roadmap");
    await mkdir(out, { recursive: true });
    for (const [id, task] of Object.entries(tasks)) await writeFile(path.join(out, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
    await writeFile(path.join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    console.log(`kaiten: ${index.columns.map((c) => `${c.key} ${c.items.length}`).join(", ")}`);
  } catch (error) {
    warn(`kaiten: ${dir} roadmap hidden — ${error.message}`);
  }
}
