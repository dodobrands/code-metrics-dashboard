// Renders the dashboard from charts.json (spec) + data/meta.json (bounds/hero)
// + one data/charts/<id>.json per chart (only that chart's series).
// Related series share one chart; shares/versions render as 100% stacked areas.

import Chart from "chart.js/auto";
import zoomPlugin from "chartjs-plugin-zoom";
import phrases from "./phrases.json";

Chart.register(zoomPlugin);
// Axis ticks and legend default to Chart.js' own sans-serif; match the page's mono.
Chart.defaults.font.family = getComputedStyle(document.body).getPropertyValue("--mono").trim();
// The webfont loads async; re-render once it's ready so canvases aren't stuck on the fallback.
document.fonts.ready.then(() => {
  for (const c of charts) c.update();
});

// dataviz categorical palette (validated: adjacent-pair CVD dE 9.1 light / 8.4 dark).
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const NAMES = {
  "Task\\b.*\\{.*@MainActor": "Task { @MainActor }",
  "@available(*, deprecated": "@available deprecated",
};
const nameOf = (k) => NAMES[k] || k;

// Every mounted chart, so the date-range picker can retarget all their x-axes.
const charts = [];

// Create a chart and wire double-click to reset any zoom/pan on it.
function mount(canvas, config) {
  const chart = new Chart(canvas, config);
  canvas.title = "scroll to zoom · shift-drag to pan · double-click to reset";
  canvas.ondblclick = () => chart.resetZoom();
  charts.push(chart);
}

// Min/max timestamp across a chart's own series — for charts that scale to
// their own data range (`selfBounds`) instead of the shared full-history axis,
// so a young metric isn't a flat line squished at the far right.
function seriesBounds(byName) {
  let min = Infinity, max = -Infinity;
  for (const s of byName.values())
    for (const [t] of s.points) { if (t < min) min = t; if (t > max) max = t; }
  return Number.isFinite(min) && max > min ? { min, max } : null;
}

const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);
function ink() {
  const s = getComputedStyle(document.body);
  return { grid: s.getPropertyValue("--grid").trim(), muted: s.getPropertyValue("--muted").trim() };
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Typographic cleanup for AUTHORED PROSE only (titles, notes, hero) — never for
// code labels: legend/tooltip series names stay verbatim (e.g. `import XCTest`).
// …, em-dash, curly apostrophe, and a non-breaking space after short words so
// prepositions/articles/conjunctions don't dangle at a line end.
const typo = (s) =>
  s
    .replace(/\.\.\./g, "…")
    .replace(/ --? /g, " — ")
    .replace(/(\w)'(\w)/g, "$1’$2")
    .replace(/(^|\s)(a|an|the|of|to|in|on|at|by|is|as|or|and|for|vs)\s+/gi, "$1$2 ");
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const commonScales = (bounds) => {
  const { muted } = ink();
  const grid = isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  return {
    x: { type: "linear", min: bounds.min, max: bounds.max, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 8, callback: (v) => new Date(v).getFullYear(), font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, maxTicksLimit: 5, font: { size: 11 } } },
  };
};
const legendConfig = () => ({ display: true, position: "bottom", labels: { color: ink().muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "line", padding: 16, font: { size: 11 } } });
const tooltipConfig = (fmt) => ({ callbacks: { title: (i) => new Date(i[0].parsed.x).toISOString().slice(0, 10), label: (i) => ` ${i.dataset.label}: ${fmt(i.parsed.y)}` } });
const ZOOM = {
  zoom: { wheel: { enabled: true }, drag: { enabled: true, backgroundColor: hexA("#f05138", 0.12), borderColor: hexA("#f05138", 0.5), borderWidth: 1 }, mode: "x" },
  pan: { enabled: true, mode: "x", modifierKey: "shift" },
};
// layout.padding insets the plot from the canvas edges — same 4px scale as CSS
// (8 = --sp-2, 16 = --sp-4) so the 100% area never hugs the card border.
// zoom/pan is clamped to the data extent [bounds.min, bounds.max] via limits.x.
const baseOptions = (scales, single, bounds) => ({ responsive: true, maintainAspectRatio: false, animation: false, normalized: true, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } }, plugins: { legend: single ? { display: false } : legendConfig(), zoom: { ...ZOOM, limits: { x: { min: bounds.min, max: bounds.max, minRange: 864e5 } } } }, scales });

function lineChart(canvas, spec, byName, bounds) {
  const colors = palette();
  // A chart without an explicit `series` list draws every series in its data
  // file — used for dynamic sets like the per-type build warnings.
  const names = spec.series ?? [...byName.keys()];
  const datasets = names.filter((n) => byName.has(n)).map((n, i) => ({
    label: nameOf(n), data: byName.get(n).points.map(([x, y]) => ({ x, y })),
    borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
    borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3, tension: 0.12, fill: false,
  }));
  const opts = baseOptions(commonScales(bounds), datasets.length === 1, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y}`);
  mount(canvas, { type: "line", data: { datasets }, options: opts });
}

// Ranked horizontal bars from each series' latest value. For high-cardinality
// breakdowns (by module / by message) where 40+ overlapping lines are
// unreadable and the shared-index tooltip covers the whole plot. A snapshot,
// not a time series — so it isn't registered with the date-range picker.
function barChart(canvas, spec, byName) {
  const colors = palette();
  const { muted } = ink();
  const grid = isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const names = spec.series ?? [...byName.keys()];
  let rows = names.filter((n) => byName.has(n))
    .map((n) => { const p = byName.get(n).points; return { label: nameOf(n), value: p.length ? p[p.length - 1][1] : 0 }; })
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (spec.topN && rows.length > spec.topN) {
    const rest = rows.slice(spec.topN).reduce((s, r) => s + r.value, 0);
    rows = rows.slice(0, spec.topN);
    if (rest > 0) rows.push({ label: "Other", value: rest });
  }
  // Grow the card so every bar keeps a legible height.
  canvas.parentElement.style.height = `${Math.max(160, rows.length * 22 + 24)}px`;
  new Chart(canvas, {
    type: "bar",
    data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.value), backgroundColor: colors[0], borderRadius: 3, barThickness: 12 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, indexAxis: "y",
      // Long labels (a few method signatures) truncate with an ellipsis; the
      // untruncated label is the tooltip title.
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => items[0].label, label: (i) => ` ${i.parsed.x}` } } },
      scales: {
        x: { beginAtZero: true, grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, precision: 0 } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 28 ? l.slice(0, 27) + "…" : l; } } },
      },
    },
  });
}

// Stacked 100% area from a set of series (SwiftUI/UIKit) or a version histogram.
function stack100(canvas, datasets, bounds) {
  const scales = commonScales(bounds);
  scales.y = { ...scales.y, stacked: true, min: 0, max: 100, ticks: { ...scales.y.ticks, callback: (v) => `${v}%` } };
  const opts = baseOptions(scales, false, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y.toFixed(1)}%`);
  opts.plugins.tooltip.filter = (item) => item.parsed.y > 0; // hide 0% rows
  mount(canvas, { type: "line", data: { datasets }, options: opts });
}

function shareChart(canvas, spec, byName, bounds) {
  const colors = palette();
  const [a, b] = spec.series;
  const ma = new Map(byName.get(a).points), mb = new Map(byName.get(b).points);
  const ts = [...ma.keys()].filter((t) => mb.has(t)).sort((x, y) => x - y);
  const pa = [], pb = [];
  for (const t of ts) {
    const sum = ma.get(t) + mb.get(t), share = sum > 0 ? (ma.get(t) / sum) * 100 : 0;
    pa.push({ x: t, y: share }); pb.push({ x: t, y: 100 - share });
  }
  stack100(canvas, [
    { label: nameOf(a), data: pa, borderColor: colors[0], backgroundColor: hexA(colors[0], 0.78), borderWidth: 0, pointRadius: 0, fill: "origin", tension: 0 },
    { label: nameOf(b), data: pb, borderColor: colors[1], backgroundColor: hexA(colors[1], 0.78), borderWidth: 0, pointRadius: 0, fill: "-1", tension: 0 },
  ], bounds);
}

// Swift version share — newest version at the bottom so it grows upward.
function versionsChart(canvas, spec, byName, bounds) {
  const colors = palette();
  const metric = byName.get(spec.series[0]);
  const asc = [...new Set(metric.points.flatMap(([, h]) => Object.keys(h)))].sort();
  const colorOf = (v) => colors[asc.indexOf(v) % colors.length];
  const datasets = [...asc].reverse().map((ver) => ({
    label: `Swift ${ver}`,
    data: metric.points.map(([t, h]) => {
      const total = Object.values(h).reduce((s, n) => s + n, 0);
      return { x: t, y: total ? ((h[ver] || 0) / total) * 100 : 0 };
    }),
    borderColor: colorOf(ver), backgroundColor: hexA(colorOf(ver), 0.85), borderWidth: 0, pointRadius: 0, fill: true, tension: 0,
  }));
  stack100(canvas, datasets, bounds);
}

// --- headline thesis (stats computed in build.py, shipped in data/meta.json) ---

function heroThesis(meta) {
  const h = meta.hero || {};
  return h.swift6Total ? `<span class="hero-stat"><b>${h.swift6Pct}%</b> of ${h.swift6Total} targets on Swift 6</span>` : "";
}

// --- date-range picker --------------------------------------------------------

const DAY = 864e5;
const RANGES = [
  { label: "All time", ms: null },
  { label: "Last 5 years", ms: 5 * 365 * DAY },
  { label: "Last 3 years", ms: 3 * 365 * DAY },
  { label: "Last year", ms: 365 * DAY },
  { label: "Last 6 months", ms: 182 * DAY },
  { label: "Last 3 months", ms: 91 * DAY },
  { label: "Last month", ms: 30 * DAY },
  { label: "Last week", ms: 7 * DAY },
];
function rangePicker(bounds) {
  const sel = document.getElementById("rangepick");
  if (!sel) return;
  for (const r of RANGES) {
    const o = document.createElement("option");
    o.textContent = r.label;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    const r = RANGES[sel.selectedIndex];
    const min = r.ms == null ? bounds.min : Math.max(bounds.min, bounds.max - r.ms);
    for (const c of charts) {
      c.options.scales.x.min = min;
      c.options.scales.x.max = bounds.max;
      c.update("none");
    }
  };
}

// -----------------------------------------------------------------------------

async function main() {
  const [specs, meta] = await Promise.all([
    fetch("charts.json").then((r) => r.json()),
    fetch("data/meta.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  if (meta.repo) document.getElementById("repo").textContent = meta.repo;
  document.getElementById("hero").innerHTML = heroThesis(meta);
  const bounds = meta.bounds;

  // Each chart's data lives in its own file — fetch them all in parallel.
  const datas = await Promise.all(specs.map((s) => fetch(`data/charts/${s.id}.json`, { cache: "no-store" }).then((r) => r.json())));

  const app = document.getElementById("app");
  app.textContent = "";
  let group = null, section = null;
  specs.forEach((spec, i) => {
    const byName = new Map(datas[i].series.map((s) => [s.name, s]));
    if (!(spec.series ?? [...byName.keys()]).some((n) => byName.has(n))) return;
    if (spec.group !== group) {
      group = spec.group;
      section = document.createElement("section");
      section.innerHTML = `<div class="section-head"><h2>${escapeHtml(group)}</h2></div>`;
      app.appendChild(section);
    }
    const card = document.createElement("figure");
    card.className = "card";
    card.innerHTML = `<figcaption><h3>${escapeHtml(typo(spec.title))}</h3>${spec.note ? `<p>${escapeHtml(typo(spec.note))}</p>` : ""}</figcaption><div class="canvas-wrap"><canvas></canvas></div>`;
    section.appendChild(card);
    const canvas = card.querySelector("canvas");
    const b = spec.selfBounds ? (seriesBounds(byName) || bounds) : bounds;
    if (spec.kind === "share") shareChart(canvas, spec, byName, b);
    else if (spec.kind === "versions") versionsChart(canvas, spec, byName, b);
    else if (spec.kind === "bar") barChart(canvas, spec, byName);
    else lineChart(canvas, spec, byName, b);
  });
  rangePicker(bounds);
}

// --- roadmap modals (board + per-task dialogs are built into index.html at
// deploy from roadmap/*.json; here we only wire click → showModal) -------------

function wireRoadmap() {
  for (const btn of document.querySelectorAll(".card-item[data-dialog]")) {
    const dlg = document.getElementById(btn.dataset.dialog);
    if (!dlg) continue;
    btn.addEventListener("click", () => dlg.showModal());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  }
}

// Footer easter egg — tap the dodo for a random one-liner from phrases.json.
function wireDodo() {
  const dodo = document.getElementById("dodo-egg");
  const bubble = document.getElementById("dodo-bubble");
  if (!dodo || !bubble || !phrases.length) return;
  let last = -1;
  let hideTimer;
  dodo.addEventListener("click", () => {
    let i = Math.floor(Math.random() * phrases.length);
    if (phrases.length > 1 && i === last) i = (i + 1) % phrases.length; // no repeat in a row
    last = i;
    bubble.textContent = phrases[i];
    bubble.classList.remove("show");
    void bubble.offsetWidth; // reflow so re-adding replays the pop on every tap
    bubble.classList.add("show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bubble.classList.remove("show"), 4000);
  });
}

wireRoadmap();
wireDodo();
main().catch((e) => { document.getElementById("app").textContent = `Failed to load metrics: ${e}`; });
