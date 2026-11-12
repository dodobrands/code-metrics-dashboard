#!/usr/bin/env node
// Pulls an app's roadmap cards from Kaiten into <dir>/roadmap/kaiten/ — gitignored,
// rebuilt on every deploy — where build-roadmap merges them after the hand-written
// cards of roadmap/index.json.
//
// An app opts in with roadmap/kaiten.json: { "filters": [ { …GET /cards params } ] }.
// Each filter is passed to Kaiten as is (board_id, lane_id, type_id, tag_ids…), so a
// project narrows its cards however it needs. Of what the filters return, only cards
// with "Roadmap: publish" ticked are published, under their "Roadmap: title (EN)" and
// "Roadmap: description (EN)" (Markdown). Kaiten's column type picks the roadmap
// column: queue → Backlog, done → Done, anything in between → In Progress. Progress
// is the share of done children; a child with children of its own (an epic inside a
// project) counts as its children, so a project's progress is its epics' tasks.
//
//   KAITEN_URL=https://<company>.kaiten.ru/api/latest KAITEN_TOKEN=… node scripts/kaiten-roadmap.mjs <dir>
//
// KAITEN_URL is the repository variable of the same name. Without KAITEN_TOKEN or
// KAITEN_URL it skips with a warning (local runs keep the hand cards), but fails on
// CI, where a missing secret would silently empty the roadmap.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API = process.env.KAITEN_URL;
export const PROP = { publish: "id_681824", title: "id_681825", description: "id_681826" };
const PAGE = 100;

// Kaiten column types: 1 queue, 2 in progress, 3 done.
export function columnKey(column) {
  if (/cancel/i.test(column.title)) return null; // the Projects board parks dropped projects in a type-2 "Cancelled"
  return { 1: "backlog", 3: "done" }[column.type] ?? "progress";
}

export function progress(children) {
  let done = 0, total = 0;
  for (const c of children) {
    if (c.children_count > 0) { done += c.children_done; total += c.children_count; }
    else { done += c.state === 3 ? 1 : 0; total += 1; }
  }
  return total ? done / total : null;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

// The Markdown a Kaiten text field realistically holds: paragraphs, "- " and "1. "
// lists, **bold**, *italic*, `code`, [links](https://…). Everything else is text.
export function markdown(src) {
  if (!src.trim()) return "";
  const blocks = src.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const list = (re, tag) =>
        lines.every((l) => re.test(l)) && `<${tag}>${lines.map((l) => `<li>${inline(l.replace(re, ""))}</li>`).join("")}</${tag}>`;
      return list(/^[-*]\s+/, "ul") || list(/^\d+[.)]\s+/, "ol") || `<p>${inline(lines.join(" "))}</p>`;
    })
    .join(" ");
}

async function get(token, route) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + route, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.json();
    if (attempt === 4 || (res.status !== 429 && res.status < 500)) throw new Error(`Kaiten ${res.status} on ${route}`);
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
  for (const filter of config.filters) {
    for (const card of await all(token, "/cards", { archived: false, ...filter })) {
      if (card.properties?.[PROP.publish]) seen.set(card.id, card);
    }
  }

  const out = path.join(dir, "roadmap", "kaiten");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const columns = { backlog: [], progress: [], done: [] };
  for (const card of seen.values()) {
    const key = columnKey(card.column);
    const title = card.properties[PROP.title]?.trim();
    if (!key) continue;
    if (!title) {
      console.warn(`kaiten: ${card.id} "${card.title}" is ticked for the roadmap but has no English title — skipped`);
      continue;
    }
    const task = { title, description: markdown(card.properties[PROP.description] ?? "") };
    if (key === "progress") {
      const p = progress(await all(token, `/cards/${card.id}/children`));
      if (p !== null) task.progress = p;
    }
    const id = `kaiten-${card.id}`;
    await writeFile(path.join(out, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
    columns[key].push({ id, at: key === "done" ? -Date.parse(card.last_moved_to_done_at ?? card.updated) : Date.parse(card.created) });
  }
  // Done shows the newest first; the other columns keep the order cards were started in.
  const index = { columns: Object.entries(columns).map(([key, cards]) => ({ key, items: cards.sort((a, b) => a.at - b.at).map((c) => c.id) })) };
  await writeFile(path.join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = process.argv[2];
  const token = process.env.KAITEN_TOKEN;
  if (!token || !API) {
    if (process.env.CI) throw new Error("KAITEN_TOKEN and KAITEN_URL are required on CI: without them the Kaiten roadmap cards would silently vanish");
    console.warn(`kaiten: no KAITEN_TOKEN or KAITEN_URL — ${dir} gets its hand-written roadmap cards only`);
  } else {
    const index = await pull(dir, token);
    console.log(`kaiten: ${index.columns.map((c) => `${c.key} ${c.items.length}`).join(", ")}`);
  }
}
