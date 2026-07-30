// Renders the dashboard from charts.json (spec) + data/meta.json (bounds/hero)
// + one data/charts/<id>.json per chart (only that chart's series).
// Related series share one chart; shares/versions render as 100% stacked areas.

// dataviz categorical palette (validated: adjacent-pair CVD ΔE 9.1 light / 8.4 dark).
const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const NAMES = {
  "Task\\b.*\\{.*@MainActor": "Task { @MainActor }",
  "@available(*, deprecated": "@available deprecated",
};
const nameOf = (k) => NAMES[k] || k;

if (window.ChartZoom) Chart.register(window.ChartZoom);

// Every mounted chart, so the date-range picker can retarget all their x-axes.
const charts = [];

// Create a chart and wire double-click to reset any zoom/pan on it.
function mount(canvas, config) {
  const chart = new Chart(canvas, config);
  canvas.title = "scroll to zoom · shift-drag to pan · double-click to reset";
  canvas.ondblclick = () => chart.resetZoom();
  charts.push(chart);
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
const typo = (s) => s.replace(/\.\.\./g, "…").replace(/ --? /g, " — ").replace(/(\w)'(\w)/g, "$1’$2");
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
  const datasets = spec.series.filter((n) => byName.has(n)).map((n, i) => ({
    label: nameOf(n), data: byName.get(n).points.map(([x, y]) => ({ x, y })),
    borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length],
    borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3, tension: 0.12, fill: false,
  }));
  const opts = baseOptions(commonScales(bounds), datasets.length === 1, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y}`);
  mount(canvas, { type: "line", data: { datasets }, options: opts });
}

// Stacked 100% area from a set of series (SwiftUI/UIKit) or a version histogram.
function stack100(canvas, datasets, bounds) {
  const scales = commonScales(bounds);
  scales.y = { ...scales.y, stacked: true, min: 0, max: 100, ticks: { ...scales.y.ticks, callback: (v) => `${v}%` } };
  const opts = baseOptions(scales, false, bounds);
  opts.plugins.tooltip = tooltipConfig((y) => `${y.toFixed(1)}%`);
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
  const stat = h.swift6Total ? `<span class="hero-stat"><b>${h.swift6Pct}%</b> of ${h.swift6Total} targets on Swift 6</span>` : "";
  const dek = [];
  if (h.swiftUIShare != null) dek.push(`SwiftUI is ${h.swiftUIShare}% of framework imports`);
  dek.push("Swift Testing is overtaking XCTest");
  return `${stat}<p class="hero-dek">${escapeHtml(typo(dek.join(" · ")))} — ${meta.years} years of modernization, one commit at a time.</p>`;
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
  document.getElementById("updated").textContent = new Date(meta.updated).toISOString().slice(0, 10);
  document.getElementById("hero").innerHTML = heroThesis(meta);
  const bounds = meta.bounds;

  // Each chart's data lives in its own file — fetch them all in parallel.
  const datas = await Promise.all(specs.map((s) => fetch(`data/charts/${s.id}.json`, { cache: "no-store" }).then((r) => r.json())));

  const app = document.getElementById("app");
  app.textContent = "";
  let group = null, section = null;
  specs.forEach((spec, i) => {
    const byName = new Map(datas[i].series.map((s) => [s.name, s]));
    if (!spec.series.some((n) => byName.has(n))) return;
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
    if (spec.kind === "share") shareChart(canvas, spec, byName, bounds);
    else if (spec.kind === "versions") versionsChart(canvas, spec, byName, bounds);
    else lineChart(canvas, spec, byName, bounds);
  });
  rangePicker(bounds);
}

main().catch((e) => { document.getElementById("app").textContent = `Failed to load metrics: ${e}`; });
